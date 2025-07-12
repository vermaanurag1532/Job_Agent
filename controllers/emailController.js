import { emailService } from '../services/emailService.js';
import { campaignRepository } from '../repositories/campaignRepository.js';
import { v4 as uuidv4 } from 'uuid';

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

            if (!req.file) {
                return res.status(400).json({ error: 'Resume file is required' });
            }

            // Generate unique campaign ID
            const campaignId = uuidv4();

            // Create campaign record
            const campaign = {
                id: campaignId,
                recipientEmail,
                recipientName,
                companyName,
                companyWebsite,
                jobTitle,
                emailType,
                additionalInfo,
                resumePath: req.file.path,
                status: 'pending',
                createdAt: new Date(),
                updatedAt: new Date(),
                emailSent: null,
                lastFollowUp: null,
                followUpCount: 0,
                originalEmail: '',
                emailPreview: '',
                senderInfo: null
            };

            campaignRepository.addCampaign(campaign);

            // Background processing
            (async () => {
                try {
                    campaign.status = 'processing';
                    campaign.updatedAt = new Date();

                    // Extract resume text
                    const resumeText = await emailService.extractResumeText(req.file.path);
                    
                    // Extract sender information from resume
                    const senderInfo = await emailService.extractSenderInfo(resumeText);
                    campaign.senderInfo = senderInfo;

                    campaign.status = 'researching';
                    campaign.updatedAt = new Date();

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

                    campaign.originalEmail = generatedEmail;
                    campaign.emailPreview = generatedEmail.substring(0, 500) + '...';

                    // Extract subject and body
                    const subjectMatch = generatedEmail.match(/Subject:\s*(.+)/);
                    const subject = subjectMatch ? subjectMatch[1].trim() : `Application for ${jobTitle} position`;
                    
                    const bodyStart = generatedEmail.indexOf('\n\n') + 2;
                    const body = generatedEmail.substring(bodyStart).trim();

                    // Send email with resume attachment
                    const emailResult = await emailService.sendEmail(recipientEmail, subject, body, senderInfo, req.file.path);

                    if (emailResult.success) {
                        campaign.status = 'sent';
                        campaign.emailSent = new Date();
                    } else {
                        campaign.status = 'failed';
                        campaign.error = emailResult.error;
                    }

                    campaign.updatedAt = new Date();

                } catch (error) {
                    console.error('Error in background processing:', error);
                    campaign.status = 'failed';
                    campaign.error = error.message;
                    campaign.updatedAt = new Date();
                }
            })();

            res.json({
                success: true,
                campaignId,
                status: 'pending',
                message: 'Email campaign started. AI is processing your resume and will send the email shortly.',
                emailPreview: 'Processing...'
            });

        } catch (error) {
            console.error('Error in send-email endpoint:', error);
            res.status(500).json({ error: error.message });
        }
    }
}

export const emailController = new EmailController();