// services/cronService.js (Updated with threading support)
import cron from 'node-cron';
import fs from 'fs';
import { campaignRepository } from '../repositories/campaignRepository.js';
import { emailService } from './emailService.js';
import { userRepository } from '../repositories/userRepository.js';
import { formatFollowUpSubject } from '../utils/emailThreading.js';

class CronService {
    startAutomatedFollowUp() {
        // Run every day at 9 AM
        cron.schedule('0 9 * * *', async () => {
            console.log('🤖 Running automated follow-up check...');
            
            try {
                const campaigns = await campaignRepository.getCampaignsForFollowUp();
                console.log(`📊 Found ${campaigns.length} campaigns eligible for follow-up`);
                
                for (const campaign of campaigns) {
                    try {
                        console.log(`📧 Sending automated follow-up for campaign ${campaign.id}`);
                        
                        // Get user's email credentials for this campaign
                        const userWithCredentials = await userRepository.findByIdWithEmailCredentials(campaign.user_id);
                        const userEmailCredentials = userWithCredentials && userWithCredentials.has_email_credentials ? {
                            email: userWithCredentials.email,
                            appPassword: userWithCredentials.email_password
                        } : null;

                        const followUpNumber = (campaign.follow_up_count || 0) + 1;

                        // 🔥 NEW: Check for threading information
                        if (!campaign.message_id || !campaign.thread_id) {
                            console.error(`❌ Campaign ${campaign.id} missing threading information, skipping follow-up`);
                            continue;
                        }

                        // Extract original subject for threading
                        const originalSubject = campaign.original_email ? 
                            campaign.original_email.match(/Subject:\s*(.+)/)?.[1]?.trim() : 
                            `${campaign.job_title} Application`;

                        // Generate follow-up email
                        const followUpEmail = await emailService.generateFollowUpEmail(
                            campaign.original_email,
                            campaign.company_name,
                            campaign.job_title,
                            campaign.sender_info,
                            followUpNumber,
                            originalSubject
                        );

                        // Extract subject and body
                        const subjectMatch = followUpEmail.match(/Subject:\s*(.+)/);
                        const subject = subjectMatch ? 
                            subjectMatch[1].trim() : 
                            formatFollowUpSubject(originalSubject, followUpNumber);
                        
                        const bodyStart = followUpEmail.indexOf('\n\n') + 2;
                        const body = followUpEmail.substring(bodyStart).trim();

                        // 🔥 NEW: Prepare threading options for automated follow-up
                        const threadingOptions = {
                            originalMessageId: campaign.message_id,
                            threadId: campaign.thread_id,
                            emailReferences: campaign.email_references || campaign.message_id,
                            campaignType: 'automated_followup',
                            followUpNumber: followUpNumber,
                            isReply: true  // 🔥 NEW: This is a reply to the original email
                        };

                        console.log(`📧 Automated follow-up threading options for campaign ${campaign.id}:`, threadingOptions);

                        // Send follow-up email
                        const emailResult = await emailService.sendEmail(
                            campaign.recipient_email, 
                            subject, 
                            body, 
                            campaign.sender_info,
                            null, // No attachment for follow-ups
                            campaign.user_id,
                            userEmailCredentials,
                            threadingOptions  // 🔥 NEW: Include threading options
                        );

                        if (emailResult.success) {
                            // 🔥 NEW: Store follow-up in separate table for thread tracking
                            await campaignRepository.addFollowUp({
                                campaignId: campaign.id,
                                userId: campaign.user_id,
                                messageId: emailResult.threadingMessageId,
                                inReplyTo: campaign.message_id,
                                emailReferences: threadingOptions.emailReferences,
                                subject: subject,
                                emailContent: followUpEmail,
                                followupNumber: followUpNumber
                            });

                            // Update campaign with follow-up info and threading data
                            await campaignRepository.updateCampaign(
                                campaign.id, 
                                campaign.user_id, 
                                {
                                    followUpCount: followUpNumber,
                                    lastFollowUp: new Date(),
                                    emailReferences: `${threadingOptions.emailReferences} ${emailResult.threadingMessageId}`.trim()
                                }
                            );
                            
                            console.log(`✅ Automated follow-up sent successfully for campaign ${campaign.id}`);
                            console.log(`   Threading: Reply to ${campaign.message_id}`);
                            console.log(`   New Message ID: ${emailResult.threadingMessageId}`);
                        } else {
                            console.error(`❌ Failed to send automated follow-up for campaign ${campaign.id}:`, emailResult.error);
                        }
                    } catch (error) {
                        console.error(`❌ Error sending automated follow-up for campaign ${campaign.id}:`, error);
                    }
                }
                
                console.log('✅ Automated follow-up check completed');
            } catch (error) {
                console.error('❌ Error in automated follow-up process:', error);
            }
        });
    }

    startCleanupJob() {
        // Cleanup old campaigns every Sunday at midnight
        cron.schedule('0 0 * * 0', async () => {
            console.log('🧹 Starting cleanup of old campaigns...');
            
            try {
                const oldCampaigns = await campaignRepository.getOldCampaigns(30); // 30 days old
                console.log(`📊 Found ${oldCampaigns.length} old campaigns to clean up`);
                
                let deletedFiles = 0;
                let deletedCampaigns = 0;

                // Delete resume files first
                for (const campaign of oldCampaigns) {
                    if (campaign.resume_path) {
                        try {
                            if (fs.existsSync(campaign.resume_path)) {
                                fs.unlinkSync(campaign.resume_path);
                                deletedFiles++;
                            }
                        } catch (error) {
                            console.error(`❌ Error deleting resume file ${campaign.resume_path}:`, error);
                        }
                    }
                }

                // Delete campaigns from database (including follow-ups via cascade)
                if (oldCampaigns.length > 0) {
                    const campaignIds = oldCampaigns.map(c => c.id);
                    deletedCampaigns = await campaignRepository.deleteOldCampaigns(campaignIds);
                }

                console.log(`✅ Cleanup complete:`);
                console.log(`   - Deleted ${deletedFiles} resume files`);
                console.log(`   - Deleted ${deletedCampaigns} old campaigns (including follow-ups)`);
            } catch (error) {
                console.error('❌ Error in cleanup process:', error);
            }
        });
    }

    // Health check job (optional)
    startHealthCheck() {
        // Run health check every hour
        cron.schedule('0 * * * *', async () => {
            try {
                // Check database connection
                const { query } = await import('../config/database.js');
                await query('SELECT 1');
                
                // Check for stuck campaigns (processing for more than 1 hour)
                const stuckCampaigns = await query(`
                    SELECT id, user_id, status, updated_at
                    FROM campaigns 
                    WHERE status IN ('processing', 'researching') 
                    AND updated_at < NOW() - INTERVAL '1 hour'
                `);

                if (stuckCampaigns.rows.length > 0) {
                    console.log(`⚠️ Found ${stuckCampaigns.rows.length} stuck campaigns, marking as failed`);
                    
                    for (const campaign of stuckCampaigns.rows) {
                        await campaignRepository.updateCampaign(
                            campaign.id, 
                            campaign.user_id, 
                            {
                                status: 'failed',
                                errorMessage: 'Campaign processing timeout'
                            }
                        );
                    }
                }

                // 🔥 NEW: Check for campaigns missing threading information
                const campaignsWithoutThreading = await query(`
                    SELECT id, user_id, status
                    FROM campaigns 
                    WHERE status = 'sent' 
                    AND (message_id IS NULL OR thread_id IS NULL)
                `);

                if (campaignsWithoutThreading.rows.length > 0) {
                    console.log(`⚠️ Found ${campaignsWithoutThreading.rows.length} campaigns missing threading information`);
                    // Could add logic here to reconstruct threading info if needed
                }

            } catch (error) {
                console.error('❌ Health check failed:', error);
            }
        });
    }

    // 🔥 NEW: Threading maintenance job
    startThreadingMaintenance() {
        // Run threading maintenance every day at 2 AM
        cron.schedule('0 2 * * *', async () => {
            console.log('🔧 Running threading maintenance...');
            
            try {
                // Check for orphaned follow-ups
                const { query } = await import('../config/database.js');
                
                const orphanedFollowUps = await query(`
                    SELECT cf.id, cf.campaign_id
                    FROM campaign_followups cf
                    LEFT JOIN campaigns c ON cf.campaign_id = c.id
                    WHERE c.id IS NULL
                `);

                if (orphanedFollowUps.rows.length > 0) {
                    console.log(`🧹 Found ${orphanedFollowUps.rows.length} orphaned follow-ups, cleaning up...`);
                    
                    const followUpIds = orphanedFollowUps.rows.map(f => f.id);
                    const placeholders = followUpIds.map((_, index) => `$${index + 1}`).join(',');
                    await query(`DELETE FROM campaign_followups WHERE id IN (${placeholders})`, followUpIds);
                    
                    console.log(`✅ Cleaned up ${orphanedFollowUps.rows.length} orphaned follow-ups`);
                }

                // Validate threading integrity
                const invalidThreads = await query(`
                    SELECT id, message_id, thread_id
                    FROM campaigns 
                    WHERE status = 'sent' 
                    AND (
                        (message_id IS NOT NULL AND NOT message_id ~ '^<.*@.*>$') OR
                        (thread_id IS NOT NULL AND thread_id = '')
                    )
                `);

                if (invalidThreads.rows.length > 0) {
                    console.log(`⚠️ Found ${invalidThreads.rows.length} campaigns with invalid threading data`);
                    // Could add logic here to fix invalid threading data
                }

                console.log('✅ Threading maintenance completed');
            } catch (error) {
                console.error('❌ Error in threading maintenance:', error);
            }
        });
    }
}

const cronService = new CronService();

export const startAutomatedFollowUp = () => cronService.startAutomatedFollowUp();
export const startCleanupJob = () => cronService.startCleanupJob();
export const startHealthCheck = () => cronService.startHealthCheck();
export const startThreadingMaintenance = () => cronService.startThreadingMaintenance(); // 🔥 NEW