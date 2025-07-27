import { query } from '../config/database.js';
import { encryptToken, decryptToken } from '../utils/encryption.js';

class UserRepository {
    // Create a new user with basic Google info
    async createUser({ email, googleUserId, fullName, profilePicture }) {
        const sql = `
            INSERT INTO users (
                email, google_user_id, full_name, profile_picture, last_login
            )
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
                   created_at, updated_at, last_login, is_active, has_email_credentials,
                   has_gemini_api_key
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
                   created_at, updated_at, last_login, is_active, has_email_credentials,
                   has_gemini_api_key
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
                   created_at, updated_at, last_login, is_active, has_email_credentials,
                   has_gemini_api_key
            FROM users 
            WHERE user_id = $1 AND is_active = true
        `;
        const result = await query(sql, [userId]);
        return result.rows[0] || null;
    }

    // Get user with email credentials
    async findByIdWithEmailCredentials(userId) {
        const sql = `
            SELECT user_id, email, google_user_id, full_name, profile_picture, 
                   created_at, updated_at, last_login, is_active, has_email_credentials,
                   email_password
            FROM users 
            WHERE user_id = $1 AND is_active = true
        `;
        const result = await query(sql, [userId]);
        const user = result.rows[0];
        
        if (user && user.email_password) {
            // Decrypt email password before returning
            user.email_password = decryptToken(user.email_password);
        }
        
        return user || null;
    }

    // Get user with Gemini API credentials
    async findByIdWithGeminiCredentials(userId) {
        const sql = `
            SELECT user_id, email, google_user_id, full_name, profile_picture, 
                   created_at, updated_at, last_login, is_active, has_gemini_api_key,
                   gemini_api_key
            FROM users 
            WHERE user_id = $1 AND is_active = true
        `;
        const result = await query(sql, [userId]);
        const user = result.rows[0];
        
        if (user && user.gemini_api_key) {
            // Decrypt Gemini API key before returning
            user.gemini_api_key = decryptToken(user.gemini_api_key);
        }
        
        return user || null;
    }

    // Get user with all credentials (email + gemini)
    async findByIdWithAllCredentials(userId) {
        const sql = `
            SELECT user_id, email, google_user_id, full_name, profile_picture, 
                   created_at, updated_at, last_login, is_active, has_email_credentials,
                   has_gemini_api_key, email_password, gemini_api_key
            FROM users 
            WHERE user_id = $1 AND is_active = true
        `;
        const result = await query(sql, [userId]);
        const user = result.rows[0];
        
        if (user) {
            // Decrypt credentials before returning
            if (user.email_password) {
                user.email_password = decryptToken(user.email_password);
            }
            if (user.gemini_api_key) {
                user.gemini_api_key = decryptToken(user.gemini_api_key);
            }
        }
        
        return user || null;
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

    // Store user's email credentials (encrypted)
    async updateEmailCredentials(userId, emailPassword) {
        const sql = `
            UPDATE users 
            SET email_password = $2, 
                has_email_credentials = true
            WHERE user_id = $1
            RETURNING user_id, has_email_credentials
        `;
        
        const encryptedPassword = encryptToken(emailPassword);
        const result = await query(sql, [userId, encryptedPassword]);
        return result.rows[0];
    }

    // Store user's Gemini API key (encrypted)
    async updateGeminiApiKey(userId, geminiApiKey) {
        const sql = `
            UPDATE users 
            SET gemini_api_key = $2, 
                has_gemini_api_key = true
            WHERE user_id = $1
            RETURNING user_id, has_gemini_api_key
        `;
        
        const encryptedApiKey = encryptToken(geminiApiKey);
        const result = await query(sql, [userId, encryptedApiKey]);
        return result.rows[0];
    }

    // Remove user's email credentials
    async removeEmailCredentials(userId) {
        const sql = `
            UPDATE users 
            SET email_password = NULL, 
                has_email_credentials = false
            WHERE user_id = $1
            RETURNING user_id, has_email_credentials
        `;
        
        const result = await query(sql, [userId]);
        return result.rows[0];
    }

    // Remove user's Gemini API key
    async removeGeminiApiKey(userId) {
        const sql = `
            UPDATE users 
            SET gemini_api_key = NULL, 
                has_gemini_api_key = false
            WHERE user_id = $1
            RETURNING user_id, has_gemini_api_key
        `;
        
        const result = await query(sql, [userId]);
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

    // Find or create user (simplified version)
    async findOrCreateUser({ email, googleUserId, fullName, profilePicture }) {
        // First, try to find existing user
        let user = await this.findByGoogleId(googleUserId);
        
        if (!user) {
            // Create new user if not found
            user = await this.createUser({ email, googleUserId, fullName, profilePicture });
        } else {
            // Update last login for existing user
            await this.updateLastLogin(user.user_id);
        }
        
        return user;
    }
}

export const userRepository = new UserRepository();