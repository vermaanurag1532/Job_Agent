// repositories/campaignRepository.js (Updated with threading support - FIXED)
import { query } from '../config/database.js';
import { v4 as uuidv4 } from 'uuid';

class CampaignRepository {
    // Get all campaigns for a user
    async getCampaignsByUserId(userId) {
        const sql = `
            SELECT id, user_id, recipient_email, recipient_name, company_name, 
                   company_website, job_title, email_type, additional_info, 
                   status, created_at, updated_at, email_sent, last_follow_up, 
                   follow_up_count, email_preview, error_message,
                   message_id, in_reply_to, email_references, thread_id
            FROM campaigns 
            WHERE user_id = $1 
            ORDER BY created_at DESC
        `;
        const result = await query(sql, [userId]);
        return result.rows;
    }

    // Get campaign by ID (with user verification)
    async getCampaignById(campaignId, userId) {
        const sql = `
            SELECT id, user_id, recipient_email, recipient_name, company_name, 
                   company_website, job_title, email_type, additional_info, 
                   resume_path, status, created_at, updated_at, email_sent, 
                   last_follow_up, follow_up_count, original_email, email_preview, 
                   sender_info, error_message,
                   message_id, in_reply_to, email_references, thread_id
            FROM campaigns 
            WHERE id = $1 AND user_id = $2
        `;
        const result = await query(sql, [campaignId, userId]);
        const campaign = result.rows[0];
        
        // Parse sender_info if it exists and is a string
        if (campaign && campaign.sender_info && typeof campaign.sender_info === 'string') {
            try {
                campaign.sender_info = JSON.parse(campaign.sender_info);
            } catch (error) {
                console.error('Error parsing sender_info JSON:', error);
                campaign.sender_info = null;
            }
        }
        
        return campaign || null;
    }

    // Add new campaign
    async addCampaign(campaignData) {
        const {
            userId,
            recipientEmail,
            recipientName,
            companyName,
            companyWebsite,
            jobTitle,
            emailType,
            additionalInfo,
            resumePath
        } = campaignData;

        const id = uuidv4();
        const sql = `
            INSERT INTO campaigns (
                id, user_id, recipient_email, recipient_name, company_name, 
                company_website, job_title, email_type, additional_info, 
                resume_path, status
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'pending')
            RETURNING id, user_id, recipient_email, recipient_name, company_name, 
                      company_website, job_title, email_type, status, created_at
        `;
        
        const result = await query(sql, [
            id, userId, recipientEmail, recipientName, companyName, 
            companyWebsite, jobTitle, emailType, additionalInfo, resumePath
        ]);
        
        return result.rows[0];
    }

    // 🔥 UPDATED: Update campaign with threading support
    async updateCampaign(campaignId, userId, updateData) {
        const allowedFields = [
            'status', 'email_sent', 'last_follow_up', 'follow_up_count',
            'original_email', 'email_preview', 'sender_info', 'error_message',
            'message_id', 'in_reply_to', 'email_references', 'thread_id'
        ];

        const updates = [];
        const values = [];
        let paramCount = 1;

        Object.keys(updateData).forEach(key => {
            const dbField = key.replace(/([A-Z])/g, '_$1').toLowerCase();
            if (allowedFields.includes(dbField)) {
                updates.push(`${dbField} = $${paramCount}`);
                
                // Handle JSON fields properly
                if (dbField === 'sender_info' && typeof updateData[key] === 'object') {
                    values.push(JSON.stringify(updateData[key]));
                } else {
                    values.push(updateData[key]);
                }
                paramCount++;
            }
        });

        if (updates.length === 0) {
            throw new Error('No valid fields to update');
        }

        values.push(campaignId, userId);
        const sql = `
            UPDATE campaigns 
            SET ${updates.join(', ')}, updated_at = CURRENT_TIMESTAMP
            WHERE id = $${paramCount} AND user_id = $${paramCount + 1}
            RETURNING id, user_id, status, updated_at, message_id, thread_id
        `;

        console.log('🔍 Update SQL:', sql);
        console.log('🔍 Update values:', values);

        const result = await query(sql, values);
        return result.rows[0];
    }

    // 🔥 NEW: Update campaign with threading information
    async updateCampaignThreading(campaignId, userId, threadingData) {
        const { messageId, threadId, inReplyTo = null, emailReferences = null } = threadingData;
        
        const sql = `
            UPDATE campaigns 
            SET message_id = $1, 
                thread_id = $2, 
                in_reply_to = $3, 
                email_references = $4,
                updated_at = CURRENT_TIMESTAMP
            WHERE id = $5 AND user_id = $6
            RETURNING id, message_id, thread_id, in_reply_to, email_references
        `;
        
        const result = await query(sql, [messageId, threadId, inReplyTo, emailReferences, campaignId, userId]);
        return result.rows[0];
    }

    // 🔥 NEW: Add follow-up to campaign_followups table
    async addFollowUp(followUpData) {
        const {
            campaignId,
            userId,
            messageId,
            inReplyTo,
            emailReferences,
            subject,
            emailContent,
            followupNumber
        } = followUpData;

        const id = uuidv4();
        const sql = `
            INSERT INTO campaign_followups (
                id, campaign_id, user_id, message_id, in_reply_to, 
                email_references, subject, email_content, followup_number
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
            RETURNING id, campaign_id, message_id, followup_number, sent_at
        `;
        
        const result = await query(sql, [
            id, campaignId, userId, messageId, inReplyTo, 
            emailReferences, subject, emailContent, followupNumber
        ]);
        
        return result.rows[0];
    }

    // 🔥 NEW: Get follow-ups for a campaign
    async getFollowUpsByCampaignId(campaignId, userId) {
        const sql = `
            SELECT id, campaign_id, message_id, in_reply_to, email_references,
                   subject, email_content, followup_number, sent_at, status
            FROM campaign_followups 
            WHERE campaign_id = $1 AND user_id = $2 
            ORDER BY followup_number ASC
        `;
        const result = await query(sql, [campaignId, userId]);
        return result.rows;
    }

    // 🔥 UPDATED: Get campaigns for automated follow-up with threading info
    async getCampaignsForFollowUp() {
        const sql = `
            SELECT id, user_id, recipient_email, company_name, job_title, 
                   email_sent, last_follow_up, follow_up_count, original_email, 
                   sender_info, message_id, thread_id, email_references
            FROM campaigns 
            WHERE status = 'sent' 
            AND follow_up_count < 2 
            AND sender_info IS NOT NULL
            AND message_id IS NOT NULL
            AND (
                (follow_up_count = 0 AND email_sent <= NOW() - INTERVAL '3 days') OR
                (follow_up_count = 1 AND last_follow_up <= NOW() - INTERVAL '7 days')
            )
        `;
        const result = await query(sql);
        
        // Parse sender_info for each campaign
        result.rows.forEach(campaign => {
            if (campaign.sender_info && typeof campaign.sender_info === 'string') {
                try {
                    campaign.sender_info = JSON.parse(campaign.sender_info);
                } catch (error) {
                    console.error('Error parsing sender_info JSON for follow-up:', error);
                    campaign.sender_info = null;
                }
            }
        });
        
        return result.rows;
    }

    // Delete campaign
    async deleteCampaign(campaignId, userId) {
        // First delete associated follow-ups
        await query('DELETE FROM campaign_followups WHERE campaign_id = $1 AND user_id = $2', [campaignId, userId]);
        
        // Then delete the campaign
        const sql = `
            DELETE FROM campaigns 
            WHERE id = $1 AND user_id = $2
            RETURNING id, resume_path
        `;
        const result = await query(sql, [campaignId, userId]);
        return result.rows[0];
    }

    // Get old campaigns for cleanup
    async getOldCampaigns(daysOld = 30) {
        const sql = `
            SELECT id, user_id, resume_path
            FROM campaigns 
            WHERE created_at <= NOW() - INTERVAL '${daysOld} days'
        `;
        const result = await query(sql);
        return result.rows;
    }

    // Bulk delete old campaigns
    async deleteOldCampaigns(campaignIds) {
        if (campaignIds.length === 0) return 0;
        
        // Delete follow-ups first
        const followUpPlaceholders = campaignIds.map((_, index) => `$${index + 1}`).join(',');
        await query(`DELETE FROM campaign_followups WHERE campaign_id IN (${followUpPlaceholders})`, campaignIds);
        
        // Delete campaigns
        const placeholders = campaignIds.map((_, index) => `$${index + 1}`).join(',');
        const sql = `DELETE FROM campaigns WHERE id IN (${placeholders})`;
        const result = await query(sql, campaignIds);
        return result.rowCount;
    }

    // Get campaign statistics for user
    async getUserCampaignStats(userId) {
        const sql = `
            SELECT 
                COUNT(*) as total_campaigns,
                COUNT(CASE WHEN status = 'sent' THEN 1 END) as sent_campaigns,
                COUNT(CASE WHEN status = 'failed' THEN 1 END) as failed_campaigns,
                COUNT(CASE WHEN status = 'pending' THEN 1 END) as pending_campaigns,
                COUNT(CASE WHEN status = 'processing' THEN 1 END) as processing_campaigns,
                SUM(follow_up_count) as total_followups,
                MAX(created_at) as last_campaign_date
            FROM campaigns 
            WHERE user_id = $1
        `;
        const result = await query(sql, [userId]);
        return result.rows[0];
    }

    // Search campaigns
    async searchCampaigns(userId, searchTerm, filters = {}) {
        let sql = `
            SELECT id, recipient_email, recipient_name, company_name, 
                   job_title, status, created_at, email_sent, follow_up_count,
                   message_id, thread_id
            FROM campaigns 
            WHERE user_id = $1
        `;
        
        const params = [userId];
        let paramCount = 2;

        if (searchTerm) {
            sql += ` AND (
                company_name ILIKE $${paramCount} OR 
                job_title ILIKE $${paramCount} OR 
                recipient_email ILIKE $${paramCount}
            )`;
            params.push(`%${searchTerm}%`);
            paramCount++;
        }

        if (filters.status) {
            sql += ` AND status = $${paramCount}`;
            params.push(filters.status);
            paramCount++;
        }

        if (filters.dateFrom) {
            sql += ` AND created_at >= $${paramCount}`;
            params.push(filters.dateFrom);
            paramCount++;
        }

        if (filters.dateTo) {
            sql += ` AND created_at <= $${paramCount}`;
            params.push(filters.dateTo);
            paramCount++;
        }

        sql += ` ORDER BY created_at DESC LIMIT 50`;

        const result = await query(sql, params);
        return result.rows;
    }

    // 🔥 UPDATED: Methods for common operations with threading support
    async updateStatus(campaignId, userId, status, additionalData = {}) {
        const updateData = { status, ...additionalData };
        return await this.updateCampaign(campaignId, userId, updateData);
    }

    async markAsSent(campaignId, userId, emailContent = null, threadingData = {}) {
        const updateData = {
            status: 'sent',
            emailSent: new Date().toISOString(),
            messageId: threadingData.messageId,
            threadId: threadingData.threadId,
            inReplyTo: threadingData.inReplyTo || null,
            emailReferences: threadingData.emailReferences || null
        };
        
        if (emailContent) {
            updateData.originalEmail = emailContent;
            updateData.emailPreview = emailContent.substring(0, 500) + '...';
        }
        
        return await this.updateCampaign(campaignId, userId, updateData);
    }

    async markAsFailed(campaignId, userId, errorMessage) {
        return await this.updateCampaign(campaignId, userId, {
            status: 'failed',
            errorMessage: errorMessage
        });
    }

    async incrementFollowUpCount(campaignId, userId) {
        // First get current count
        const campaign = await this.getCampaignById(campaignId, userId);
        if (!campaign) {
            throw new Error('Campaign not found');
        }

        return await this.updateCampaign(campaignId, userId, {
            followUpCount: (campaign.follow_up_count || 0) + 1,
            lastFollowUp: new Date().toISOString()
        });
    }

    async addSenderInfo(campaignId, userId, senderInfo) {
        return await this.updateCampaign(campaignId, userId, {
            senderInfo: senderInfo
        });
    }

    async addEmailContent(campaignId, userId, emailContent) {
        return await this.updateCampaign(campaignId, userId, {
            originalEmail: emailContent,
            emailPreview: emailContent.substring(0, 500) + '...'
        });
    }

    // 🔥 UPDATED: Method to update campaign with all email data at once including threading
    async updateCampaignWithEmailData(campaignId, userId, emailData) {
        const { status, emailContent, senderInfo, errorMessage, threadingData } = emailData;
        
        const updateData = {
            status,
            emailSent: status === 'sent' ? new Date().toISOString() : null,
            originalEmail: emailContent,
            emailPreview: emailContent ? emailContent.substring(0, 500) + '...' : null,
            senderInfo: senderInfo,
            errorMessage: errorMessage || null
        };

        // Add threading data if provided
        if (threadingData) {
            updateData.messageId = threadingData.messageId;
            updateData.threadId = threadingData.threadId;
            updateData.inReplyTo = threadingData.inReplyTo || null;
            updateData.emailReferences = threadingData.emailReferences || null;
        }

        // Remove null values
        Object.keys(updateData).forEach(key => {
            if (updateData[key] === null || updateData[key] === undefined) {
                delete updateData[key];
            }
        });

        return await this.updateCampaign(campaignId, userId, updateData);
    }

    // 🔥 NEW: Get email thread for a campaign
    async getEmailThread(campaignId, userId) {
        const campaign = await this.getCampaignById(campaignId, userId);
        if (!campaign) return null;

        const followUps = await this.getFollowUpsByCampaignId(campaignId, userId);
        
        return {
            original: {
                messageId: campaign.message_id,
                threadId: campaign.thread_id,
                subject: campaign.original_email ? campaign.original_email.match(/Subject:\s*(.+)/)?.[1] : null,
                content: campaign.original_email,
                sentAt: campaign.email_sent
            },
            followUps: followUps.map(followUp => ({
                messageId: followUp.message_id,
                inReplyTo: followUp.in_reply_to,
                emailReferences: followUp.email_references,
                subject: followUp.subject,
                content: followUp.email_content,
                sentAt: followUp.sent_at,
                followUpNumber: followUp.followup_number
            }))
        };
    }
}

export const campaignRepository = new CampaignRepository();