// services/gmailService.js (Updated with threading support)
import { google } from 'googleapis';
import { userRepository } from '../repositories/userRepository.js';
import { createThreadingHeaders, formatFollowUpSubject } from '../utils/emailThreading.js';
import dotenv from 'dotenv';

dotenv.config();

class GmailService {
    constructor() {
        this.oauth2Client = new google.auth.OAuth2(
            process.env.GOOGLE_CLIENT_ID,
            process.env.GOOGLE_CLIENT_SECRET,
            process.env.GOOGLE_CALLBACK_URL
        );
    }

    // Get authenticated Gmail client for user
    async getGmailClient(userId) {
        try {
            const user = await userRepository.findByIdWithTokens(userId);
            
            if (!user || !user.gmail_permission_granted) {
                throw new Error('User has not granted Gmail permissions');
            }

            if (!user.google_access_token) {
                throw new Error('No access token available');
            }

            // Check if token is expired
            const now = new Date();
            const tokenExpiry = new Date(user.google_token_expires_at);
            
            if (now >= tokenExpiry) {
                console.log('Token expired, attempting to refresh...');
                
                if (!user.google_refresh_token) {
                    throw new Error('Token expired and no refresh token available');
                }
                
                await this.refreshAccessToken(userId, user.google_refresh_token);
                // Get updated user data
                const updatedUser = await userRepository.findByIdWithTokens(userId);
                user.google_access_token = updatedUser.google_access_token;
            }

            // Set credentials
            this.oauth2Client.setCredentials({
                access_token: user.google_access_token,
                refresh_token: user.google_refresh_token
            });

            // Create Gmail API client
            const gmail = google.gmail({ version: 'v1', auth: this.oauth2Client });
            return gmail;
        } catch (error) {
            console.error('Error getting Gmail client:', error);
            throw error;
        }
    }

    // Refresh access token
    async refreshAccessToken(userId, refreshToken) {
        try {
            this.oauth2Client.setCredentials({
                refresh_token: refreshToken
            });

            const { credentials } = await this.oauth2Client.refreshAccessToken();
            const newTokenExpiresAt = new Date(credentials.expiry_date);

            await userRepository.updateGmailTokens(userId, {
                accessToken: credentials.access_token,
                refreshToken: credentials.refresh_token || refreshToken,
                tokenExpiresAt: newTokenExpiresAt
            });

            console.log('✅ Access token refreshed successfully');
            return credentials.access_token;
        } catch (error) {
            console.error('Error refreshing access token:', error);
            
            // If refresh fails, mark Gmail permissions as revoked
            const { query } = await import('../config/database.js');
            await query(
                'UPDATE users SET gmail_permission_granted = false WHERE user_id = $1',
                [userId]
            );
            
            throw new Error('Failed to refresh token. Please re-authorize Gmail access.');
        }
    }

    // 🔥 UPDATED: Send email via Gmail API with threading support
    async sendEmailViaGmail(userId, emailOptions, threadingOptions = {}) {
        try {
            const { to, subject, body, attachments = [] } = emailOptions;
            const gmail = await this.getGmailClient(userId);
            const user = await userRepository.findById(userId);

            // 🔥 NEW: Generate threading headers
            const threadHeaders = createThreadingHeaders({
                senderEmail: user.email,
                originalMessageId: threadingOptions.originalMessageId || null,
                threadId: threadingOptions.threadId || null,
                emailReferences: threadingOptions.emailReferences || '',
                isReply: threadingOptions.isReply || false
            });

            // Create email message
            const messageParts = [];
            
            // Headers with threading support
            messageParts.push(`From: ${user.full_name} <${user.email}>`);
            messageParts.push(`To: ${to}`);
            messageParts.push(`Subject: ${subject}`);
            messageParts.push(`MIME-Version: 1.0`);
            
            // 🔥 NEW: Add threading headers
            if (threadHeaders['Message-ID']) {
                messageParts.push(`Message-ID: ${threadHeaders['Message-ID']}`);
            }
            if (threadHeaders['In-Reply-To']) {
                messageParts.push(`In-Reply-To: ${threadHeaders['In-Reply-To']}`);
            }
            if (threadHeaders['References']) {
                messageParts.push(`References: ${threadHeaders['References']}`);
            }
            if (threadHeaders['X-Thread-ID']) {
                messageParts.push(`X-Thread-ID: ${threadHeaders['X-Thread-ID']}`);
            }
            
            // 🔥 NEW: Add campaign-specific headers
            if (threadingOptions.campaignType) {
                messageParts.push(`X-Campaign-Type: ${threadingOptions.campaignType}`);
            }
            if (threadingOptions.followUpNumber) {
                messageParts.push(`X-Follow-Up-Number: ${threadingOptions.followUpNumber}`);
            }
            
            if (attachments.length > 0) {
                const boundary = `boundary_${Date.now()}`;
                messageParts.push(`Content-Type: multipart/mixed; boundary="${boundary}"`);
                messageParts.push('');
                
                // Email body part
                messageParts.push(`--${boundary}`);
                messageParts.push('Content-Type: text/plain; charset="UTF-8"');
                messageParts.push('');
                messageParts.push(body);
                messageParts.push('');
                
                // Attachment parts
                for (const attachment of attachments) {
                    const fs = await import('fs');
                    const fileContent = fs.default.readFileSync(attachment.path);
                    const base64Content = fileContent.toString('base64');
                    
                    messageParts.push(`--${boundary}`);
                    messageParts.push(`Content-Type: ${attachment.contentType}`);
                    messageParts.push(`Content-Disposition: attachment; filename="${attachment.filename}"`);
                    messageParts.push('Content-Transfer-Encoding: base64');
                    messageParts.push('');
                    messageParts.push(base64Content);
                    messageParts.push('');
                }
                
                messageParts.push(`--${boundary}--`);
            } else {
                messageParts.push('Content-Type: text/plain; charset="UTF-8"');
                messageParts.push('');
                messageParts.push(body);
            }

            const message = messageParts.join('\n');
            const encodedMessage = Buffer.from(message)
                .toString('base64')
                .replace(/\+/g, '-')
                .replace(/\//g, '_')
                .replace(/=+$/, '');

            // 🔥 NEW: Handle threading in Gmail API
            const requestBody = {
                raw: encodedMessage
            };

            // If this is a reply, try to find the original thread
            if (threadingOptions.isReply && threadingOptions.originalMessageId) {
                try {
                    // Search for the original message thread
                    const searchResults = await gmail.users.messages.list({
                        userId: 'me',
                        q: `in:sent ${threadingOptions.originalMessageId.replace(/[<>]/g, '')}`
                    });

                    if (searchResults.data.messages && searchResults.data.messages.length > 0) {
                        // Get the thread ID of the original message
                        const originalMessage = await gmail.users.messages.get({
                            userId: 'me',
                            id: searchResults.data.messages[0].id
                        });

                        if (originalMessage.data.threadId) {
                            requestBody.threadId = originalMessage.data.threadId;
                            console.log(`🔗 Replying to thread: ${originalMessage.data.threadId}`);
                        }
                    }
                } catch (threadError) {
                    console.warn('Could not find original thread, sending as new message:', threadError.message);
                }
            }

            // Send the email
            const response = await gmail.users.messages.send({
                userId: 'me',
                requestBody: requestBody
            });

            console.log('✅ Email sent successfully via Gmail API:', response.data.id);
            console.log(`   Threading Message-ID: ${threadHeaders['Message-ID']}`);
            if (threadHeaders['In-Reply-To']) {
                console.log(`   In-Reply-To: ${threadHeaders['In-Reply-To']}`);
            }
            
            return { 
                success: true, 
                messageId: response.data.id,
                threadingMessageId: threadHeaders['Message-ID'],
                threadId: threadHeaders['X-Thread-ID'],
                gmailThreadId: response.data.threadId,
                method: 'gmail_api',
                senderEmail: user.email
            };
        } catch (error) {
            console.error('❌ Error sending email via Gmail API:', error);
            
            // Provide more specific error messages
            if (error.message.includes('insufficient authentication scopes')) {
                return { 
                    success: false, 
                    error: 'Gmail permissions insufficient. Please re-authorize.',
                    needsReauth: true
                };
            }
            
            if (error.message.includes('invalid_grant')) {
                return { 
                    success: false, 
                    error: 'Gmail authorization expired. Please re-authorize.',
                    needsReauth: true
                };
            }
            
            return { 
                success: false, 
                error: error.message 
            };
        }
    }

    // 🔥 NEW: Send follow-up email via Gmail API with proper threading
    async sendFollowUpViaGmail(userId, followUpOptions) {
        const {
            to,
            originalSubject,
            body,
            originalMessageId,
            threadId,
            emailReferences,
            followUpNumber,
            attachments = []
        } = followUpOptions;

        // Format subject for follow-up
        const subject = formatFollowUpSubject(originalSubject, followUpNumber, true);

        const emailOptions = {
            to,
            subject,
            body,
            attachments
        };

        const threadingOptions = {
            originalMessageId,
            threadId,
            emailReferences,
            isReply: true,
            campaignType: 'followup',
            followUpNumber
        };

        return await this.sendEmailViaGmail(userId, emailOptions, threadingOptions);
    }

    // 🔥 NEW: Get email thread from Gmail
    async getEmailThread(userId, threadId) {
        try {
            const gmail = await this.getGmailClient(userId);
            
            const thread = await gmail.users.threads.get({
                userId: 'me',
                id: threadId,
                format: 'full'
            });

            const messages = thread.data.messages.map(message => ({
                id: message.id,
                threadId: message.threadId,
                snippet: message.snippet,
                payload: message.payload,
                headers: message.payload.headers.reduce((acc, header) => {
                    acc[header.name.toLowerCase()] = header.value;
                    return acc;
                }, {}),
                body: this.extractMessageBody(message.payload),
                date: new Date(parseInt(message.internalDate))
            }));

            return {
                success: true,
                threadId: thread.data.id,
                historyId: thread.data.historyId,
                messages: messages
            };
        } catch (error) {
            console.error('Error getting email thread:', error);
            return {
                success: false,
                error: error.message
            };
        }
    }

    // Helper method to extract message body
    extractMessageBody(payload) {
        let body = '';
        
        if (payload.body && payload.body.data) {
            body = Buffer.from(payload.body.data, 'base64').toString('utf-8');
        } else if (payload.parts) {
            for (const part of payload.parts) {
                if (part.mimeType === 'text/plain' && part.body && part.body.data) {
                    body = Buffer.from(part.body.data, 'base64').toString('utf-8');
                    break;
                }
            }
        }
        
        return body;
    }

    // 🔥 NEW: Search for messages with specific Message-ID
    async findMessageByMessageId(userId, messageId) {
        try {
            const gmail = await this.getGmailClient(userId);
            
            // Clean Message-ID for search
            const cleanMessageId = messageId.replace(/[<>]/g, '');
            
            const searchResults = await gmail.users.messages.list({
                userId: 'me',
                q: `rfc822msgid:${cleanMessageId}`
            });

            if (searchResults.data.messages && searchResults.data.messages.length > 0) {
                const message = await gmail.users.messages.get({
                    userId: 'me',
                    id: searchResults.data.messages[0].id,
                    format: 'full'
                });

                return {
                    success: true,
                    message: {
                        id: message.data.id,
                        threadId: message.data.threadId,
                        headers: message.data.payload.headers.reduce((acc, header) => {
                            acc[header.name.toLowerCase()] = header.value;
                            return acc;
                        }, {}),
                        body: this.extractMessageBody(message.data.payload)
                    }
                };
            }

            return { success: false, error: 'Message not found' };
        } catch (error) {
            console.error('Error finding message by Message-ID:', error);
            return { success: false, error: error.message };
        }
    }

    // Check if user has Gmail permissions
    async hasGmailPermissions(userId) {
        try {
            const user = await userRepository.findById(userId);
            return user && user.gmail_permission_granted;
        } catch (error) {
            console.error('Error checking Gmail permissions:', error);
            return false;
        }
    }

    // Test Gmail connection
    async testGmailConnection(userId) {
        try {
            const gmail = await this.getGmailClient(userId);
            
            // Try to get user profile to test connection
            const profile = await gmail.users.getProfile({
                userId: 'me'
            });
            
            return {
                success: true,
                email: profile.data.emailAddress,
                messagesTotal: profile.data.messagesTotal,
                threadsTotal: profile.data.threadsTotal
            };
        } catch (error) {
            console.error('Gmail connection test failed:', error);
            return {
                success: false,
                error: error.message
            };
        }
    }

    // 🔥 NEW: Get threading statistics for user
    async getThreadingStats(userId) {
        try {
            const gmail = await this.getGmailClient(userId);
            
            // Search for emails with campaign headers
            const campaignEmails = await gmail.users.messages.list({
                userId: 'me',
                q: 'has:attachment OR subject:"Application for" OR subject:"Follow-up"',
                maxResults: 100
            });

            let threadedCount = 0;
            let totalCampaignEmails = 0;

            if (campaignEmails.data.messages) {
                totalCampaignEmails = campaignEmails.data.messages.length;
                
                // Check how many are part of threads
                for (const message of campaignEmails.data.messages.slice(0, 10)) {
                    try {
                        const fullMessage = await gmail.users.messages.get({
                            userId: 'me',
                            id: message.id
                        });
                        
                        if (fullMessage.data.threadId && 
                            fullMessage.data.threadId !== fullMessage.data.id) {
                            threadedCount++;
                        }
                    } catch (e) {
                        // Skip if can't access message
                    }
                }
            }

            return {
                success: true,
                stats: {
                    totalCampaignEmails,
                    threadedEmails: threadedCount,
                    threadingRate: totalCampaignEmails > 0 ? 
                        ((threadedCount / Math.min(totalCampaignEmails, 10)) * 100).toFixed(1) : 0
                }
            };
        } catch (error) {
            console.error('Error getting threading stats:', error);
            return {
                success: false,
                error: error.message
            };
        }
    }
}

export const gmailService = new GmailService();