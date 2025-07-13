import { query } from '../config/database.js';

class UserRepository {
    // Create a new user
    async createUser({ email, googleUserId, fullName, profilePicture }) {
        const sql = `
            INSERT INTO users (email, google_user_id, full_name, profile_picture, last_login)
            VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP)
            RETURNING user_id, email, google_user_id, full_name, profile_picture, created_at, last_login
        `;
        const result = await query(sql, [email, googleUserId, fullName, profilePicture]);
        return result.rows[0];
    }

    // Find user by email
    async findByEmail(email) {
        const sql = `
            SELECT user_id, email, google_user_id, full_name, profile_picture, 
                   created_at, updated_at, last_login, is_active
            FROM users 
            WHERE email = $1 AND is_active = true
        `;
        const result = await query(sql, [email]);
        return result.rows[0] || null;
    }

    // Find user by Google ID
    async findByGoogleId(googleUserId) {
        const sql = `
            SELECT user_id, email, google_user_id, full_name, profile_picture, 
                   created_at, updated_at, last_login, is_active
            FROM users 
            WHERE google_user_id = $1 AND is_active = true
        `;
        const result = await query(sql, [googleUserId]);
        return result.rows[0] || null;
    }

    // Find user by ID
    async findById(userId) {
        const sql = `
            SELECT user_id, email, google_user_id, full_name, profile_picture, 
                   created_at, updated_at, last_login, is_active
            FROM users 
            WHERE user_id = $1 AND is_active = true
        `;
        const result = await query(sql, [userId]);
        return result.rows[0] || null;
    }

    // Update user's last login
    async updateLastLogin(userId) {
        const sql = `
            UPDATE users 
            SET last_login = CURRENT_TIMESTAMP 
            WHERE user_id = $1
            RETURNING user_id, last_login
        `;
        const result = await query(sql, [userId]);
        return result.rows[0];
    }

    // Update user profile
    async updateProfile(userId, { fullName, profilePicture }) {
        const sql = `
            UPDATE users 
            SET full_name = COALESCE($2, full_name), 
                profile_picture = COALESCE($3, profile_picture)
            WHERE user_id = $1
            RETURNING user_id, email, full_name, profile_picture, updated_at
        `;
        const result = await query(sql, [userId, fullName, profilePicture]);
        return result.rows[0];
    }

    // Soft delete user
    async deactivateUser(userId) {
        const sql = `
            UPDATE users 
            SET is_active = false 
            WHERE user_id = $1
            RETURNING user_id, is_active
        `;
        const result = await query(sql, [userId]);
        return result.rows[0];
    }

    // Find or create user (for OAuth)
    async findOrCreateUser({ email, googleUserId, fullName, profilePicture }) {
        // First, try to find existing user
        let user = await this.findByGoogleId(googleUserId);
        
        if (!user) {
            // If not found by Google ID, try by email
            user = await this.findByEmail(email);
            
            if (user) {
                // User exists but doesn't have Google ID, update it
                const updateSql = `
                    UPDATE users 
                    SET google_user_id = $1, last_login = CURRENT_TIMESTAMP
                    WHERE user_id = $2
                    RETURNING user_id, email, google_user_id, full_name, profile_picture, created_at, last_login
                `;
                const result = await query(updateSql, [googleUserId, user.user_id]);
                return result.rows[0];
            } else {
                // Create new user
                return await this.createUser({ email, googleUserId, fullName, profilePicture });
            }
        } else {
            // User found, update last login
            await this.updateLastLogin(user.user_id);
            return user;
        }
    }

    // Get user statistics
    async getUserStats(userId) {
        const sql = `
            SELECT 
                COUNT(*) as total_campaigns,
                COUNT(CASE WHEN status = 'sent' THEN 1 END) as sent_campaigns,
                COUNT(CASE WHEN status = 'failed' THEN 1 END) as failed_campaigns,
                COUNT(CASE WHEN status = 'pending' THEN 1 END) as pending_campaigns
            FROM campaigns 
            WHERE user_id = $1
        `;
        const result = await query(sql, [userId]);
        return result.rows[0];
    }
}

export const userRepository = new UserRepository();