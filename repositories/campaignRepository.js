import { query } from '../config/database.js';
import { v4 as uuidv4 } from 'uuid';

class CampaignRepository {
    // Get all campaigns for a user
    async getCampaignsByUserId(userId) {
        const sql = `
            SELECT id, user_id, recipient_email, recipient_name, company_name, 
                   company_website, job_title, email_type, additional_info, 
                   status, created_at, updated_at, email_sent, last_follow_up, 
                   follow_up_count, email_preview, error_message
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
                   sender_info, error_message
            FROM campaigns 
            WHERE id = $1 AND user_id = $2
        `;
        const result = await query(sql, [campaignId, userId]);
        return result.rows[0] || null;
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

    // 🔥 FIXED: Update campaign - Proper SQL parameterized queries
    async updateCampaign(campaignId, userId, updateData) {
        const allowedFields = [
            'status', 'email_sent', 'last_follow_up', 'follow_up_count',
            'original_email', 'email_preview', 'sender_info', 'error_message'
        ];

        const updates = [];
        const values = [];
        let paramCount = 1;

        Object.keys(updateData).forEach(key => {
            const dbField = key.replace(/([A-Z])/g, '_$1').toLowerCase();
            if (allowedFields.includes(dbField)) {
                updates.push(`${dbField} = $${paramCount}`); // 🔥 FIXED: Proper placeholder
                values.push(updateData[key]);
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
            RETURNING id, user_id, status, updated_at
        `;

        console.log('🔍 Update SQL:', sql);
        console.log('🔍 Update values:', values);

        const result = await query(sql, values);
        return result.rows[0];
    }

    // Delete campaign
    async deleteCampaign(campaignId, userId) {
        const sql = `
            DELETE FROM campaigns 
            WHERE id = $1 AND user_id = $2
            RETURNING id, resume_path
        `;
        const result = await query(sql, [campaignId, userId]);
        return result.rows[0];
    }

    // Get campaigns for automated follow-up
    async getCampaignsForFollowUp() {
        const sql = `
            SELECT id, user_id, recipient_email, company_name, job_title, 
                   email_sent, last_follow_up, follow_up_count, original_email, 
                   sender_info
            FROM campaigns 
            WHERE status = 'sent' 
            AND follow_up_count < 2 
            AND sender_info IS NOT NULL
            AND (
                (follow_up_count = 0 AND email_sent <= NOW() - INTERVAL '3 days') OR
                (follow_up_count = 1 AND last_follow_up <= NOW() - INTERVAL '7 days')
            )
        `;
        const result = await query(sql);
        return result.rows;
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

    // 🔥 FIXED: Search campaigns - Proper SQL parameterized queries
    async searchCampaigns(userId, searchTerm, filters = {}) {
        let sql = `
            SELECT id, recipient_email, recipient_name, company_name, 
                   job_title, status, created_at, email_sent, follow_up_count
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

    // 🔥 NEW: Simplified update methods for common operations
    async updateStatus(campaignId, userId, status, additionalData = {}) {
        const updateData = { status, ...additionalData };
        return await this.updateCampaign(campaignId, userId, updateData);
    }

    async markAsSent(campaignId, userId) {
        return await this.updateCampaign(campaignId, userId, {
            status: 'sent',
            emailSent: new Date().toISOString()
        });
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
            senderInfo: JSON.stringify(senderInfo)
        });
    }

    async addEmailContent(campaignId, userId, emailContent) {
        return await this.updateCampaign(campaignId, userId, {
            originalEmail: emailContent
        });
    }
}

export const campaignRepository = new CampaignRepository();