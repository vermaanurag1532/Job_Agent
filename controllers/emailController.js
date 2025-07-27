// controllers/emailController.js (FIXED - Parameter order issue)
import { emailService } from '../services/emailService.js';
import { campaignRepository } from '../repositories/campaignRepository.js';
import { userRepository } from '../repositories/userRepository.js';
import { generateThreadId, formatFollowUpSubject } from '../utils/emailThreading.js';

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

            // Generate thread ID for the campaign
            const threadId = generateThreadId(campaign.id);

            // Background processing
            (async () => {
                try {
                    // Update status to processing
                    await campaignRepository.updateStatus(campaign.id, req.user.user_id, 'processing');
                    console.log(`🔄 Campaign ${campaign.id} status: processing`);

                    // Extract resume text
                    const resumeText = await emailService.extractResumeText(req.file.path);
                    console.log(`📄 Resume text extracted: ${resumeText.length} characters`);
                    
                    // ✅ FIXED: Extract sender information from resume (correct parameter order)
                    console.log(`🔍 Extracting sender info for user ID: ${req.user.user_id}`);
                    const senderInfo = await emailService.extractSenderInfo(req.user.user_id, resumeText);
                    console.log(`📝 Sender info extracted:`, {
                        name: senderInfo.fullName,
                        email: senderInfo.email,
                        title: senderInfo.currentTitle,
                        skills: senderInfo.keySkills?.slice(0, 3)
                    });

                    // Update status to researching and add sender info
                    await campaignRepository.updateCampaign(campaign.id, req.user.user_id, {
                        status: 'researching',
                        senderInfo: senderInfo,
                        threadId: threadId
                    });
                    console.log(`🔍 Campaign ${campaign.id} status: researching`);

                    // Research company
                    const companyInfo = await emailService.researchCompany(companyName, companyWebsite);
                    console.log(`🏢 Company research completed for ${companyName}`);

                    // ✅ FIXED: Generate personalized email (correct parameter order)
                    console.log(`🤖 Generating personalized email for user ID: ${req.user.user_id}...`);
                    const generatedEmail = await emailService.generatePersonalizedEmail(
                        req.user.user_id,     // ✅ FIXED: userId first
                        companyInfo,          // then companyInfo
                        resumeText,           // then resumeText
                        senderInfo,           // then senderInfo
                        emailType,            // then emailType
                        jobTitle,             // then jobTitle
                        recipientName,        // then recipientName
                        additionalInfo        // then additionalInfo
                    );

                    // Extract subject and body
                    const subjectMatch = generatedEmail.match(/Subject:\s*(.+)/);
                    const subject = subjectMatch ? subjectMatch[1].trim() : `Application for ${jobTitle} Position at ${companyName}`;
                    const bodyMatch = generatedEmail.split('\n\n').slice(1).join('\n\n');
                    
                    console.log(`📧 Email generated - Subject: ${subject}`);

                    // Update status to sending
                    await campaignRepository.updateStatus(campaign.id, req.user.user_id, 'sending');

                    // Send email with threading support
                    const emailResult = await emailService.sendEmail(
                        recipientEmail,
                        subject,
                        bodyMatch || generatedEmail,
                        senderInfo,
                        req.file.path,
                        req.user.user_id,
                        userEmailCredentials,
                        {
                            threadId: threadId,
                            campaignType: 'original',
                            followUpNumber: 0
                        }
                    );

                    console.log(`📧 Email send result:`, {
                        success: emailResult.success,
                        method: emailResult.method,
                        senderEmail: emailResult.senderEmail,
                        threadingMessageId: emailResult.threadingMessageId,
                        error: emailResult.error
                    });

                    if (emailResult.success) {
                        // Update campaign with success data
                        await campaignRepository.updateCampaign(campaign.id, req.user.user_id, {
                            status: 'sent',
                            emailSent: new Date(),
                            originalEmail: generatedEmail,
                            emailPreview: subject,
                            messageId: emailResult.threadingMessageId,
                            threadId: emailResult.threadId
                        });
                        console.log(`✅ Campaign ${campaign.id} completed successfully`);
                    } else {
                        // Update campaign with error
                        await campaignRepository.updateCampaign(campaign.id, req.user.user_id, {
                            status: 'failed',
                            errorMessage: emailResult.error
                        });
                        console.log(`❌ Campaign ${campaign.id} failed: ${emailResult.error}`);
                    }

                } catch (error) {
                    console.error(`❌ Error in background processing:`, error);
                    
                    // Update campaign with error
                    await campaignRepository.updateCampaign(campaign.id, req.user.user_id, {
                        status: 'failed',
                        errorMessage: error.message
                    });
                }
            })();

            // Return immediate response
            res.json({
                success: true,
                message: 'Email campaign initiated successfully',
                campaignId: campaign.id,
                status: 'processing'
            });

        } catch (error) {
            console.error('Error in sendEmail:', error);
            res.status(500).json({ 
                error: 'Failed to initiate email campaign',
                details: process.env.NODE_ENV === 'development' ? error.message : undefined
            });
        }
    }

    // Get user campaigns
    async getUserCampaigns(req, res) {
        try {
            const campaigns = await campaignRepository.getUserCampaigns(req.user.user_id);
            
            // Format campaigns for response (exclude sensitive data)
            const formattedCampaigns = campaigns.map(campaign => ({
                id: campaign.id,
                recipientEmail: campaign.recipient_email,
                recipientName: campaign.recipient_name,
                companyName: campaign.company_name,
                companyWebsite: campaign.company_website,
                jobTitle: campaign.job_title,
                emailType: campaign.email_type,
                status: campaign.status,
                createdAt: campaign.created_at,
                updatedAt: campaign.updated_at,
                emailSent: campaign.email_sent,
                lastFollowUp: campaign.last_follow_up,
                followUpCount: campaign.follow_up_count,
                emailPreview: campaign.email_preview,
                errorMessage: campaign.error_message,
                // Threading information
                threadingInfo: {
                    messageId: campaign.message_id,
                    threadId: campaign.thread_id,
                    inReplyTo: campaign.in_reply_to,
                    emailReferences: campaign.email_references,
                    hasThread: !!(campaign.message_id && campaign.thread_id)
                }
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
            const { query: searchQuery, status, startDate, endDate } = req.query;
            
            const campaigns = await campaignRepository.searchCampaigns(req.user.user_id, {
                query: searchQuery,
                status,
                startDate,
                endDate
            });

            const formattedCampaigns = campaigns.map(campaign => ({
                id: campaign.id,
                recipientEmail: campaign.recipient_email,
                recipientName: campaign.recipient_name,
                companyName: campaign.company_name,
                jobTitle: campaign.job_title,
                status: campaign.status,
                createdAt: campaign.created_at,
                emailSent: campaign.email_sent,
                emailPreview: campaign.email_preview
            }));

            res.json({
                success: true,
                campaigns: formattedCampaigns,
                count: formattedCampaigns.length
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
            
            const success = await campaignRepository.deleteCampaign(id, req.user.user_id);
            
            if (success) {
                res.json({
                    success: true,
                    message: 'Campaign deleted successfully'
                });
            } else {
                res.status(404).json({ error: 'Campaign not found' });
            }
        } catch (error) {
            console.error('Error deleting campaign:', error);
            res.status(500).json({ error: 'Failed to delete campaign' });
        }
    }

    // Get campaign statistics
    async getCampaignStats(req, res) {
        try {
            const stats = await campaignRepository.getCampaignStats(req.user.user_id);
            
            // Calculate additional metrics
            const totalCampaigns = parseInt(stats.total_campaigns) || 0;
            const sentCampaigns = parseInt(stats.sent_campaigns) || 0;
            const pendingCampaigns = parseInt(stats.pending_campaigns) || 0;
            const failedCampaigns = parseInt(stats.failed_campaigns) || 0;
            
            const successRate = totalCampaigns > 0 ? 
                ((sentCampaigns / totalCampaigns) * 100).toFixed(1) : 0;
            
            const avgFollowUpsPerCampaign = sentCampaigns > 0 ? 
                ((parseInt(stats.total_followups) || 0) / sentCampaigns).toFixed(1) : 0;

            const formattedStats = {
                totalCampaigns,
                sentCampaigns,
                pendingCampaigns,
                failedCampaigns,
                successRate: parseFloat(successRate),
                totalFollowups: parseInt(stats.total_followups) || 0,
                avgFollowUpsPerCampaign: parseFloat(avgFollowUpsPerCampaign)
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

            // Get email thread information
            const emailThread = await campaignRepository.getEmailThread(id, req.user.user_id);

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
                senderInfo: campaign.sender_info,
                errorMessage: campaign.error_message,
                // Include threading information
                threadingInfo: {
                    messageId: campaign.message_id,
                    threadId: campaign.thread_id,
                    inReplyTo: campaign.in_reply_to,
                    emailReferences: campaign.email_references,
                    hasThread: !!(campaign.message_id && campaign.thread_id)
                },
                // Include full email thread
                emailThread: emailThread
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
}

// Create and export the instance
export const emailController = new EmailController();