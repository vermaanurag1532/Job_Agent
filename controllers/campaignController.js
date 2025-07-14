import { campaignRepository } from '../repositories/campaignRepository.js';
import { emailService } from '../services/emailService.js';

class CampaignController {
    // Get campaigns for the authenticated user
    async getCampaigns(req, res) {
        try {
            const campaigns = await campaignRepository.getCampaignsByUserId(req.user.user_id);
            
            // Format response data (exclude sensitive information)
            const campaignsData = campaigns.map(campaign => ({
                id: campaign.id,
                recipientEmail: campaign.recipient_email,
                recipientName: campaign.recipient_name,
                companyName: campaign.company_name,
                jobTitle: campaign.job_title,
                emailType: campaign.email_type,
                status: campaign.status,
                createdAt: campaign.created_at,
                updatedAt: campaign.updated_at,
                emailSent: campaign.email_sent,
                lastFollowUp: campaign.last_follow_up,
                followUpCount: campaign.follow_up_count,
                errorMessage: campaign.error_message,
                emailPreview: campaign.email_preview
            }));

            res.json({
                success: true,
                campaigns: campaignsData
            });
        } catch (error) {
            console.error('Error getting campaigns:', error);
            res.status(500).json({ error: 'Failed to retrieve campaigns' });
        }
    }

    // Get specific campaign by ID
    async getCampaignById(req, res) {
        try {
            const campaign = await campaignRepository.getCampaignById(
                req.params.id, 
                req.user.user_id
            );
            
            if (!campaign) {
                return res.status(404).json({ error: 'Campaign not found' });
            }

            // Format response (exclude file path for security)
            const campaignData = {
                id: campaign.id,
                recipientEmail: campaign.recipient_email,
                recipientName: campaign.recipient_name,
                companyName: campaign.company_name,
                companyWebsite: campaign.company_website,
                jobTitle: campaign.job_title,
                emailType: campaign.email_type,
                additionalInfo: campaign.additional_info,
                status: campaign.status,
                createdAt: campaign.created_at,
                updatedAt: campaign.updated_at,
                emailSent: campaign.email_sent,
                lastFollowUp: campaign.last_follow_up,
                followUpCount: campaign.follow_up_count,
                originalEmail: campaign.original_email,
                emailPreview: campaign.email_preview,
                senderInfo: campaign.sender_info, // Already parsed in repository
                errorMessage: campaign.error_message
            };

            res.json({
                success: true,
                campaign: campaignData
            });
        } catch (error) {
            console.error('Error getting campaign by ID:', error);
            res.status(500).json({ error: 'Failed to retrieve campaign' });
        }
    }

    // Send follow-up email
    async sendFollowUp(req, res) {
        try {
            const campaign = await campaignRepository.getCampaignById(
                req.params.id, 
                req.user.user_id
            );
            
            if (!campaign) {
                return res.status(404).json({ error: 'Campaign not found' });
            }

            if (campaign.status !== 'sent') {
                return res.status(400).json({ 
                    error: 'Can only follow up on sent campaigns' 
                });
            }

            if (!campaign.sender_info) {
                return res.status(400).json({ 
                    error: 'Sender information not available' 
                });
            }

            if (campaign.follow_up_count >= 2) {
                return res.status(400).json({ 
                    error: 'Maximum follow-ups (2) already sent' 
                });
            }

            console.log(`📧 Generating follow-up email for campaign ${campaign.id}`);

            // Generate follow-up email
            const followUpEmail = await emailService.generateFollowUpEmail(
                campaign.original_email,
                campaign.company_name,
                campaign.job_title,
                campaign.sender_info, // Already parsed object
                campaign.follow_up_count + 1
            );

            // Extract subject and body
            const subjectMatch = followUpEmail.match(/Subject:\s*(.+)/);
            const subject = subjectMatch ? 
                subjectMatch[1].trim() : 
                `Follow-up: ${campaign.job_title} position`;
            
            const bodyStart = followUpEmail.indexOf('\n\n') + 2;
            const body = followUpEmail.substring(bodyStart).trim();

            // Get user's email credentials for sending follow-up
            const { userRepository } = await import('../repositories/userRepository.js');
            const userWithCredentials = await userRepository.findByIdWithEmailCredentials(req.user.user_id);
            const userEmailCredentials = userWithCredentials && userWithCredentials.has_email_credentials ? {
                email: userWithCredentials.email,
                appPassword: userWithCredentials.email_password
            } : null;

            // Send follow-up email (without attachment for follow-ups)
            const emailResult = await emailService.sendEmail(
                campaign.recipient_email, 
                subject, 
                body, 
                campaign.sender_info, // Already parsed object
                null, // No attachment for follow-ups
                req.user.user_id,
                userEmailCredentials
            );

            console.log(`📧 Follow-up email result:`, {
                success: emailResult.success,
                method: emailResult.method,
                error: emailResult.error
            });

            if (emailResult.success) {
                // Update campaign with follow-up info
                await campaignRepository.updateCampaign(campaign.id, req.user.user_id, {
                    followUpCount: campaign.follow_up_count + 1,
                    lastFollowUp: new Date()
                });
                
                res.json({
                    success: true,
                    message: `Follow-up email sent successfully via ${emailResult.method}`,
                    followUpCount: campaign.follow_up_count + 1,
                    method: emailResult.method
                });
            } else {
                res.status(500).json({ 
                    error: `Failed to send follow-up: ${emailResult.error}` 
                });
            }

        } catch (error) {
            console.error('Error sending follow-up:', error);
            res.status(500).json({ error: 'Failed to send follow-up email' });
        }
    }

    // Get campaign analytics/statistics
    async getCampaignAnalytics(req, res) {
        try {
            const stats = await campaignRepository.getUserCampaignStats(req.user.user_id);
            
            // Calculate additional metrics
            const totalCampaigns = parseInt(stats.total_campaigns) || 0;
            const sentCampaigns = parseInt(stats.sent_campaigns) || 0;
            const successRate = totalCampaigns > 0 ? 
                ((sentCampaigns / totalCampaigns) * 100).toFixed(1) : 0;

            const analytics = {
                totalCampaigns,
                sentCampaigns,
                failedCampaigns: parseInt(stats.failed_campaigns) || 0,
                pendingCampaigns: parseInt(stats.pending_campaigns) || 0,
                processingCampaigns: parseInt(stats.processing_campaigns) || 0,
                totalFollowups: parseInt(stats.total_followups) || 0,
                successRate: parseFloat(successRate),
                lastCampaignDate: stats.last_campaign_date,
                averageFollowupsPerCampaign: sentCampaigns > 0 ? 
                    ((parseInt(stats.total_followups) || 0) / sentCampaigns).toFixed(1) : 0
            };

            res.json({
                success: true,
                analytics
            });
        } catch (error) {
            console.error('Error getting campaign analytics:', error);
            res.status(500).json({ error: 'Failed to retrieve analytics' });
        }
    }

    // Retry failed campaign
    async retryCampaign(req, res) {
        try {
            const campaign = await campaignRepository.getCampaignById(
                req.params.id, 
                req.user.user_id
            );
            
            if (!campaign) {
                return res.status(404).json({ error: 'Campaign not found' });
            }

            if (campaign.status !== 'failed') {
                return res.status(400).json({ 
                    error: 'Can only retry failed campaigns' 
                });
            }

            console.log(`🔄 Retrying failed campaign ${campaign.id}`);

            // Reset campaign status to pending for retry
            await campaignRepository.updateCampaign(campaign.id, req.user.user_id, {
                status: 'pending',
                errorMessage: null
            });

            res.json({
                success: true,
                message: 'Campaign queued for retry',
                campaignId: campaign.id
            });

        } catch (error) {
            console.error('Error retrying campaign:', error);
            res.status(500).json({ error: 'Failed to retry campaign' });
        }
    }

    // 🔥 NEW: Delete campaign
    async deleteCampaign(req, res) {
        try {
            const { id } = req.params;
            const deletedCampaign = await campaignRepository.deleteCampaign(id, req.user.user_id);
            
            if (!deletedCampaign) {
                return res.status(404).json({ error: 'Campaign not found' });
            }

            // Delete resume file if it exists
            if (deletedCampaign.resume_path) {
                try {
                    const fs = await import('fs');
                    if (fs.default.existsSync(deletedCampaign.resume_path)) {
                        fs.default.unlinkSync(deletedCampaign.resume_path);
                        console.log(`🗑️ Deleted resume file: ${deletedCampaign.resume_path}`);
                    }
                } catch (fileError) {
                    console.error('Error deleting resume file:', fileError);
                }
            }

            console.log(`🗑️ Campaign ${id} deleted successfully`);

            res.json({
                success: true,
                message: 'Campaign deleted successfully'
            });
        } catch (error) {
            console.error('Error deleting campaign:', error);
            res.status(500).json({ error: 'Failed to delete campaign' });
        }
    }

    // 🔥 NEW: Search campaigns
    async searchCampaigns(req, res) {
        try {
            const { q: searchTerm, status, dateFrom, dateTo } = req.query;
            const filters = { status, dateFrom, dateTo };
            
            const campaigns = await campaignRepository.searchCampaigns(
                req.user.user_id, 
                searchTerm, 
                filters
            );
            
            res.json({
                success: true,
                campaigns
            });
        } catch (error) {
            console.error('Error searching campaigns:', error);
            res.status(500).json({ error: 'Failed to search campaigns' });
        }
    }
}

// Create and export the instance
export const campaignController = new CampaignController();