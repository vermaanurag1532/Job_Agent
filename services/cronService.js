import cron from 'node-cron';
import fs from 'fs';
import { campaignRepository } from '../repositories/campaignRepository.js';
import { emailService } from './emailService.js';

class CronService {
    startAutomatedFollowUp() {
        // Run every day at 9 AM
        cron.schedule('0 9 * * *', async () => {
            console.log('Running automated follow-up check...');
            
            const now = new Date();
            const threeDaysAgo = new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000);
            const oneWeekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
            
            const campaigns = campaignRepository.getAllCampaigns();
            
            for (const campaign of campaigns) {
                if (campaign.status === 'sent' && campaign.followUpCount < 2 && campaign.senderInfo) {
                    const emailSentDate = new Date(campaign.emailSent);
                    const lastFollowUpDate = campaign.lastFollowUp ? new Date(campaign.lastFollowUp) : null;
                    
                    let shouldSendFollowUp = false;
                    
                    // First follow-up after 3 days
                    if (campaign.followUpCount === 0 && emailSentDate <= threeDaysAgo) {
                        shouldSendFollowUp = true;
                    }
                    // Second follow-up after 1 week from last follow-up
                    else if (campaign.followUpCount === 1 && lastFollowUpDate && lastFollowUpDate <= oneWeekAgo) {
                        shouldSendFollowUp = true;
                    }
                    
                    if (shouldSendFollowUp) {
                        try {
                            console.log(`Sending automated follow-up for campaign ${campaign.id}`);
                            
                            const followUpEmail = await emailService.generateFollowUpEmail(
                                campaign.originalEmail,
                                campaign.companyName,
                                campaign.jobTitle,
                                campaign.senderInfo,
                                campaign.followUpCount + 1
                            );

                            const subjectMatch = followUpEmail.match(/Subject:\s*(.+)/);
                            const subject = subjectMatch ? subjectMatch[1].trim() : `Follow-up: ${campaign.jobTitle} position`;
                            
                            const bodyStart = followUpEmail.indexOf('\n\n') + 2;
                            const body = followUpEmail.substring(bodyStart).trim();

                            const emailResult = await emailService.sendEmail(campaign.recipientEmail, subject, body, campaign.senderInfo, null);

                            if (emailResult.success) {
                                campaign.followUpCount++;
                                campaign.lastFollowUp = new Date();
                                campaign.updatedAt = new Date();
                                console.log(`Follow-up sent successfully for campaign ${campaign.id}`);
                            } else {
                                console.error(`Failed to send follow-up for campaign ${campaign.id}:`, emailResult.error);
                            }
                        } catch (error) {
                            console.error(`Error sending automated follow-up for campaign ${campaign.id}:`, error);
                        }
                    }
                }
            }
        });
    }

    startCleanupJob() {
        // Cleanup old campaigns (optional)
        cron.schedule('0 0 * * 0', () => {
            console.log('Cleaning up old campaigns...');
            const oneMonthAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
            
            const campaigns = campaignRepository.getAllCampaigns();
            const filteredCampaigns = campaigns.filter(campaign => {
                const shouldKeep = new Date(campaign.createdAt) > oneMonthAgo;
                
                if (!shouldKeep) {
                    // Delete resume file
                    try {
                        if (fs.existsSync(campaign.resumePath)) {
                            fs.unlinkSync(campaign.resumePath);
                        }
                    } catch (error) {
                        console.error('Error deleting resume file:', error);
                    }
                }
                
                return shouldKeep;
            });
            
            campaignRepository.setCampaigns(filteredCampaigns);
            console.log(`Cleanup complete. ${filteredCampaigns.length} campaigns remaining.`);
        });
    }
}

const cronService = new CronService();

export const startAutomatedFollowUp = () => cronService.startAutomatedFollowUp();
export const startCleanupJob = () => cronService.startCleanupJob();