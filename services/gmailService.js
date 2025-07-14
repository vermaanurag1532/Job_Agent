import { google } from 'googleapis';
import { userRepository } from '../repositories/userRepository.js';
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
                refreshToken: credentials.refresh_token || refreshToken, // Use new refresh token if provided
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

    // Send email via Gmail API
    async sendEmailViaGmail(userId, { to, subject, body, attachments = [] }) {
        try {
            const gmail = await this.getGmailClient(userId);
            const user = await userRepository.findById(userId);

            // Create email message
            const messageParts = [];
            
            // Headers
            messageParts.push(`From: ${user.full_name} <${user.email}>`);
            messageParts.push(`To: ${to}`);
            messageParts.push(`Subject: ${subject}`);
            messageParts.push(`MIME-Version: 1.0`);
            
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
            const encodedMessage = Buffer.from(message).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

            // Send the email
            const response = await gmail.users.messages.send({
                userId: 'me',
                requestBody: {
                    raw: encodedMessage
                }
            });

            console.log('✅ Email sent successfully via Gmail API:', response.data.id);
            return { 
                success: true, 
                messageId: response.data.id, 
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
                messagesTotal: profile.data.messagesTotal
            };
        } catch (error) {
            console.error('Gmail connection test failed:', error);
            return {
                success: false,
                error: error.message
            };
        }
    }
}

export const gmailService = new GmailService();