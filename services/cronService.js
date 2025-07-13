import cron from 'node-cron';
import fs from 'fs';
import { campaignRepository } from '../repositories/campaignRepository.js';
import { emailService } from './emailService.js';

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
                        
                        const followUpEmail = await emailService.generateFollowUpEmail(
                            campaign.original_email,
                            campaign.company_name,
                            campaign.job_title,
                            campaign.sender_info,
                            campaign.follow_up_count + 1
                        );

                        const subjectMatch = followUpEmail.match(/Subject:\s*(.+)/);
                        const subject = subjectMatch ? 
                            subjectMatch[1].trim() : 
                            `Follow-up: ${campaign.job_title} position`;
                        
                        const bodyStart = followUpEmail.indexOf('\n\n') + 2;
                        const body = followUpEmail.substring(bodyStart).trim();

                        const emailResult = await emailService.sendEmail(
                            campaign.recipient_email, 
                            subject, 
                            body, 
                            campaign.sender_info, 
                            null // No attachment for follow-ups
                        );

                        if (emailResult.success) {
                            await campaignRepository.updateCampaign(
                                campaign.id, 
                                campaign.user_id, 
                                {
                                    followUpCount: campaign.follow_up_count + 1,
                                    lastFollowUp: new Date()
                                }
                            );
                            console.log(`✅ Follow-up sent successfully for campaign ${campaign.id}`);
                        } else {
                            console.error(`❌ Failed to send follow-up for campaign ${campaign.id}:`, emailResult.error);
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

                // Delete campaigns from database
                if (oldCampaigns.length > 0) {
                    const campaignIds = oldCampaigns.map(c => c.id);
                    deletedCampaigns = await campaignRepository.deleteOldCampaigns(campaignIds);
                }

                console.log(`✅ Cleanup complete:`);
                console.log(`   - Deleted ${deletedFiles} resume files`);
                console.log(`   - Deleted ${deletedCampaigns} old campaigns`);
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
            } catch (error) {
                console.error('❌ Health check failed:', error);
            }
        });
    }
}

const cronService = new CronService();

export const startAutomatedFollowUp = () => cronService.startAutomatedFollowUp();
export const startCleanupJob = () => cronService.startCleanupJob();
export const startHealthCheck = () => cronService.startHealthCheck();