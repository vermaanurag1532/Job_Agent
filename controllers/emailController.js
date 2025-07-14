import { emailService } from '../services/emailService.js';
import { campaignRepository } from '../repositories/campaignRepository.js';
import { userRepository } from '../repositories/userRepository.js';

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

            console.log(`📧 Starting email campaign for user ${req.user.email} to ${companyName}`);

            // Get user's email credentials
            const userWithCredentials = await userRepository.findByIdWithEmailCredentials(req.user.user_id);
            const userEmailCredentials = userWithCredentials && userWithCredentials.has_email_credentials ? {
                email: userWithCredentials.email,
                appPassword: userWithCredentials.email_password
            } : null;

            console.log(`📋 Email sending method: ${userEmailCredentials ? 'User Gmail' : 'Fallback SMTP'}`);

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
            console.log(`✅ Campaign created with ID: ${campaign.id}`);

            // Background processing
            (async () => {
                try {
                    // Update status to processing
                    await campaignRepository.updateStatus(campaign.id, req.user.user_id, 'processing');
                    console.log(`🔄 Campaign ${campaign.id} status: processing`);

                    // Extract resume text
                    const resumeText = await emailService.extractResumeText(req.file.path);
                    console.log(`📄 Resume text extracted: ${resumeText.length} characters`);
                    
                    // Extract sender information from resume
                    const senderInfo = await emailService.extractSenderInfo(resumeText);
                    console.log(`📝 Sender info extracted:`, {
                        name: senderInfo.fullName,
                        email: senderInfo.email,
                        title: senderInfo.currentTitle,
                        skills: senderInfo.keySkills?.slice(0, 3)
                    });

                    // Update status to researching and add sender info
                    await campaignRepository.updateCampaign(campaign.id, req.user.user_id, {
                        status: 'researching',
                        senderInfo: senderInfo
                    });
                    console.log(`🔍 Campaign ${campaign.id} status: researching`);

                    // Research company
                    const companyInfo = await emailService.researchCompany(companyName, companyWebsite);
                    console.log(`🏢 Company research completed for ${companyName}`);

                    // Generate personalized email
                    console.log(`🤖 Generating personalized email...`);
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

                    console.log(`📧 Email generated - Subject: ${subject}`);

                    // Send email with resume attachment
                    const emailResult = await emailService.sendEmail(
                        recipientEmail, 
                        subject, 
                        body, 
                        senderInfo, 
                        req.file.path,
                        req.user.user_id,
                        userEmailCredentials
                    );

                    console.log(`📧 Email send result:`, {
                        success: emailResult.success,
                        method: emailResult.method,
                        senderEmail: emailResult.senderEmail,
                        error: emailResult.error
                    });

                    if (emailResult.success) {
                        // Use the new method to update all email data at once
                        await campaignRepository.updateCampaignWithEmailData(campaign.id, req.user.user_id, {
                            status: 'sent',
                            emailContent: generatedEmail,
                            senderInfo: senderInfo,
                            errorMessage: null
                        });
                        
                        console.log(`✅ Campaign ${campaign.id} completed successfully via ${emailResult.method}`);
                    } else {
                        await campaignRepository.updateCampaignWithEmailData(campaign.id, req.user.user_id, {
                            status: 'failed',
                            emailContent: generatedEmail,
                            senderInfo: senderInfo,
                            errorMessage: emailResult.error
                        });
                        
                        console.error(`❌ Campaign ${campaign.id} failed:`, emailResult.error);
                    }

                } catch (error) {
                    console.error('❌ Error in background processing:', error);
                    await campaignRepository.updateCampaignWithEmailData(campaign.id, req.user.user_id, {
                        status: 'failed',
                        emailContent: null,
                        senderInfo: null,
                        errorMessage: error.message
                    });
                }
            })();

            // Immediate response to user
            res.json({
                success: true,
                campaignId: campaign.id,
                status: 'pending',
                message: userEmailCredentials 
                    ? `Email campaign started. AI is processing your resume and will send the email from ${userEmailCredentials.email}.`
                    : 'Email campaign started. AI is processing your resume and will send the email using fallback SMTP (reply-to will be set to your email).',
                campaign: {
                    id: campaign.id,
                    recipientEmail: campaign.recipient_email,
                    companyName: campaign.company_name,
                    jobTitle: campaign.job_title,
                    status: campaign.status,
                    createdAt: campaign.created_at
                },
                emailMethod: userEmailCredentials ? 'user_gmail' : 'fallback_smtp'
            });

        } catch (error) {
            console.error('❌ Error in send-email endpoint:', error);
            res.status(500).json({ error: error.message });
        }
    }

    // Get user's campaigns
    async getUserCampaigns(req, res) {
        try {
            const campaigns = await campaignRepository.getCampaignsByUserId(req.user.user_id);
            
            // Format campaigns for frontend
            const formattedCampaigns = campaigns.map(campaign => ({
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
                campaigns: formattedCampaigns
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
            
            console.log(`🔍 Searching campaigns for user ${req.user.user_id}:`, {
                searchTerm,
                filters
            });
            
            const campaigns = await campaignRepository.searchCampaigns(
                req.user.user_id, 
                searchTerm, 
                filters
            );
            
            res.json({
                success: true,
                campaigns: campaigns,
                searchTerm: searchTerm,
                filters: filters,
                count: campaigns.length
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
            console.log(`🗑️ Deleting campaign ${id} for user ${req.user.user_id}`);
            
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

            console.log(`✅ Campaign ${id} deleted successfully`);

            res.json({
                success: true,
                message: 'Campaign deleted successfully',
                campaignId: id
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
            
            // Calculate additional metrics
            const totalCampaigns = parseInt(stats.total_campaigns) || 0;
            const sentCampaigns = parseInt(stats.sent_campaigns) || 0;
            const successRate = totalCampaigns > 0 ? 
                ((sentCampaigns / totalCampaigns) * 100).toFixed(1) : 0;

            const formattedStats = {
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
                stats: formattedStats
            });
        } catch (error) {
            console.error('Error getting campaign stats:', error);
            res.status(500).json({ error: 'Failed to retrieve statistics' });
        }
    }

    // Get specific campaign by ID
    async getCampaignById(req, res) {
        try {
            const { id } = req.params;
            const campaign = await campaignRepository.getCampaignById(id, req.user.user_id);
            
            if (!campaign) {
                return res.status(404).json({ error: 'Campaign not found' });
            }

            // Format campaign data (exclude sensitive file paths)
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
            const { id } = req.params;
            console.log(`📧 Sending follow-up for campaign ${id}`);
            
            const campaign = await campaignRepository.getCampaignById(id, req.user.user_id);
            
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

            // Get user's email credentials
            const userWithCredentials = await userRepository.findByIdWithEmailCredentials(req.user.user_id);
            const userEmailCredentials = userWithCredentials && userWithCredentials.has_email_credentials ? {
                email: userWithCredentials.email,
                appPassword: userWithCredentials.email_password
            } : null;

            // Send follow-up email (without attachment)
            const emailResult = await emailService.sendEmail(
                campaign.recipient_email, 
                subject, 
                body, 
                campaign.sender_info, 
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
}

// Create and export the instance
export const emailController = new EmailController();