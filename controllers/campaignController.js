import { campaignRepository } from '../repositories/campaignRepository.js';
import { emailService } from '../services/emailService.js';

class CampaignController {
    getCampaigns(req, res) {
        const campaigns = campaignRepository.getAllCampaigns();
        const campaignsData = campaigns.map(campaign => ({
            id: campaign.id,
            recipientEmail: campaign.recipientEmail,
            recipientName: campaign.recipientName,
            companyName: campaign.companyName,
            jobTitle: campaign.jobTitle,
            emailType: campaign.emailType,
            status: campaign.status,
            createdAt: campaign.createdAt,
            updatedAt: campaign.updatedAt,
            emailSent: campaign.emailSent,
            lastFollowUp: campaign.lastFollowUp,
            followUpCount: campaign.followUpCount,
            error: campaign.error,
            senderInfo: campaign.senderInfo ? {
                fullName: campaign.senderInfo.fullName,
                email: campaign.senderInfo.email,
                currentTitle: campaign.senderInfo.currentTitle
            } : null
        }));

        res.json(campaignsData);
    }

    getCampaignById(req, res) {
        const campaign = campaignRepository.getCampaignById(req.params.id);
        
        if (!campaign) {
            return res.status(404).json({ error: 'Campaign not found' });
        }

        res.json({
            ...campaign,
            resumePath: undefined // Don't expose file path
        });
    }

    async sendFollowUp(req, res) {
        try {
            const campaign = campaignRepository.getCampaignById(req.params.id);
            
            if (!campaign) {
                return res.status(404).json({ error: 'Campaign not found' });
            }

            if (campaign.status !== 'sent') {
                return res.status(400).json({ error: 'Can only follow up on sent campaigns' });
            }

            if (!campaign.senderInfo) {
                return res.status(400).json({ error: 'Sender information not available' });
            }

            // Generate follow-up email
            const followUpEmail = await emailService.generateFollowUpEmail(
                campaign.originalEmail,
                campaign.companyName,
                campaign.jobTitle,
                campaign.senderInfo,
                campaign.followUpCount + 1
            );

            // Extract subject and body
            const subjectMatch = followUpEmail.match(/Subject:\s*(.+)/);
            const subject = subjectMatch ? subjectMatch[1].trim() : `Follow-up: ${campaign.jobTitle} position`;
            
            const bodyStart = followUpEmail.indexOf('\n\n') + 2;
            const body = followUpEmail.substring(bodyStart).trim();

            // Send follow-up email (without attachment for follow-ups)
            const emailResult = await emailService.sendEmail(campaign.recipientEmail, subject, body, campaign.senderInfo, null);

            if (emailResult.success) {
                campaign.followUpCount++;
                campaign.lastFollowUp = new Date();
                campaign.updatedAt = new Date();
                
                res.json({
                    success: true,
                    message: 'Follow-up email sent successfully',
                    followUpCount: campaign.followUpCount
                });
            } else {
                res.status(500).json({ error: emailResult.error });
            }

        } catch (error) {
            console.error('Error sending follow-up:', error);
            res.status(500).json({ error: error.message });
        }
    }
}

export const campaignController = new CampaignController();