import { emailService } from '../services/emailService.js';
import { campaignRepository } from '../repositories/campaignRepository.js';

class EmailController {
    async sendEmail(req, res) {
        try {
            const {
                recipientEmail,
                recipientName,
                companyName,
                companyWebsite,
                jobTitle,
                emailType,
                additionalInfo
            } = req.body;

            // Validate required fields
            if (!recipientEmail || !companyName || !jobTitle) {
                return res.status(400).json({ 
                    error: 'Recipient email, company name, and job title are required' 
                });
            }

            if (!req.file) {
                return res.status(400).json({ error: 'Resume file is required' });
            }

            // Validate user authentication
            if (!req.user || !req.user.user_id) {
                return res.status(401).json({ error: 'User authentication required' });
            }

            // Create campaign record
            const campaignData = {
                userId: req.user.user_id,
                recipientEmail,
                recipientName,
                companyName,
                companyWebsite,
                jobTitle,
                emailType: emailType || 'application',
                additionalInfo,
                resumePath: req.file.path
            };

            const campaign = await campaignRepository.addCampaign(campaignData);

            // Background processing
            (async () => {
                try {
                    // Update status to processing
                    await campaignRepository.updateCampaign(campaign.id, req.user.user_id, {
                        status: 'processing'
                    });

                    // Extract resume text
                    const resumeText = await emailService.extractResumeText(req.file.path);
                    
                    // Extract sender information from resume
                    const senderInfo = await emailService.extractSenderInfo(resumeText);

                    // Update status to researching
                    await campaignRepository.updateCampaign(campaign.id, req.user.user_id, {
                        status: 'researching',
                        senderInfo
                    });

                    // Research company
                    const companyInfo = await emailService.researchCompany(companyName, companyWebsite);

                    // Generate personalized email
                    const generatedEmail = await emailService.generatePersonalizedEmail(
                        companyInfo,
                        resumeText,
                        senderInfo,
                        emailType,
                        jobTitle,
                        recipientName,
                        additionalInfo
                    );

                    // Extract subject and body
                    const subjectMatch = generatedEmail.match(/Subject:\s*(.+)/);
                    const subject = subjectMatch ? subjectMatch[1].trim() : `Application for ${jobTitle} position`;
                    
                    const bodyStart = generatedEmail.indexOf('\n\n') + 2;
                    const body = generatedEmail.substring(bodyStart).trim();

                    // Send email with resume attachment
                    const emailResult = await emailService.sendEmail(
                        recipientEmail, 
                        subject, 
                        body, 
                        senderInfo, 
                        req.file.path
                    );

                    if (emailResult.success) {
                        await campaignRepository.updateCampaign(campaign.id, req.user.user_id, {
                            status: 'sent',
                            emailSent: new Date(),
                            originalEmail: generatedEmail,
                            emailPreview: generatedEmail.substring(0, 500) + '...'
                        });
                    } else {
                        await campaignRepository.updateCampaign(campaign.id, req.user.user_id, {
                            status: 'failed',
                            errorMessage: emailResult.error
                        });
                    }

                } catch (error) {
                    console.error('Error in background processing:', error);
                    await campaignRepository.updateCampaign(campaign.id, req.user.user_id, {
                        status: 'failed',
                        errorMessage: error.message
                    });
                }
            })();

            res.json({
                success: true,
                campaignId: campaign.id,
                status: 'pending',
                message: 'Email campaign started. AI is processing your resume and will send the email shortly.',
                campaign: {
                    id: campaign.id,
                    recipientEmail: campaign.recipient_email,
                    companyName: campaign.company_name,
                    jobTitle: campaign.job_title,
                    status: campaign.status,
                    createdAt: campaign.created_at
                }
            });

        } catch (error) {
            console.error('Error in send-email endpoint:', error);
            res.status(500).json({ error: error.message });
        }
    }

    // Get user's campaigns
    async getUserCampaigns(req, res) {
        try {
            const campaigns = await campaignRepository.getCampaignsByUserId(req.user.user_id);
            res.json({
                success: true,
                campaigns
            });
        } catch (error) {
            console.error('Error getting user campaigns:', error);
            res.status(500).json({ error: 'Failed to retrieve campaigns' });
        }
    }

    // Search campaigns
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

    // Delete campaign
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
                    }
                } catch (fileError) {
                    console.error('Error deleting resume file:', fileError);
                }
            }

            res.json({
                success: true,
                message: 'Campaign deleted successfully'
            });
        } catch (error) {
            console.error('Error deleting campaign:', error);
            res.status(500).json({ error: 'Failed to delete campaign' });
        }
    }

    // Get campaign statistics
    async getCampaignStats(req, res) {
        try {
            const stats = await campaignRepository.getUserCampaignStats(req.user.user_id);
            res.json({
                success: true,
                stats
            });
        } catch (error) {
            console.error('Error getting campaign stats:', error);
            res.status(500).json({ error: 'Failed to retrieve statistics' });
        }
    }
}

// Create and export the instance
export const emailController = new EmailController();