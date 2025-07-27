import { userRepository } from '../repositories/userRepository.js';
import { query } from '../config/database.js';

class AuthService {
    // Handle OAuth user creation/update
    async handleOAuthUser(profile) {
        try {
            const userData = {
                email: profile.emails[0].value,
                googleUserId: profile.id,
                fullName: profile.displayName,
                profilePicture: profile.photos?.[0]?.value || null
            };
            
            const user = await userRepository.findOrCreateUser(userData);
            return user;
        } catch (error) {
            console.error('Error handling OAuth user:', error);
            throw error;
        }
    }

    // Save email credentials
    async saveEmailCredentials(userId, emailPassword) {
        try {
            return await userRepository.updateEmailCredentials(userId, emailPassword);
        } catch (error) {
            console.error('Error saving email credentials:', error);
            throw error;
        }
    }

    // Save Gemini API credentials
    async saveGeminiCredentials(userId, geminiApiKey) {
        try {
            return await userRepository.updateGeminiApiKey(userId, geminiApiKey);
        } catch (error) {
            console.error('Error saving Gemini credentials:', error);
            throw error;
        }
    }

    // Remove email credentials
    async removeEmailCredentials(userId) {
        try {
            return await userRepository.removeEmailCredentials(userId);
        } catch (error) {
            console.error('Error removing email credentials:', error);
            throw error;
        }
    }

    // Remove Gemini API credentials
    async removeGeminiCredentials(userId) {
        try {
            return await userRepository.removeGeminiApiKey(userId);
        } catch (error) {
            console.error('Error removing Gemini credentials:', error);
            throw error;
        }
    }

    // Get user stats
    async getUserStats(userId) {
        try {
            const statsQuery = `
                SELECT 
                    COUNT(*) as total_campaigns,
                    COUNT(CASE WHEN status = 'sent' THEN 1 END) as sent_campaigns,
                    COUNT(CASE WHEN status = 'pending' THEN 1 END) as pending_campaigns,
                    COUNT(CASE WHEN status = 'failed' THEN 1 END) as failed_campaigns,
                    SUM(follow_up_count) as total_followups
                FROM campaigns 
                WHERE user_id = $1
            `;
            
            const result = await query(statsQuery, [userId]);
            return result.rows[0] || {
                total_campaigns: 0,
                sent_campaigns: 0,
                pending_campaigns: 0,
                failed_campaigns: 0,
                total_followups: 0
            };
        } catch (error) {
            console.error('Error getting user stats:', error);
            return {
                total_campaigns: 0,
                sent_campaigns: 0,
                pending_campaigns: 0,
                failed_campaigns: 0,
                total_followups: 0
            };
        }
    }

    // Logout user
    async logout(userId) {
        try {
            await userRepository.updateLastLogin(userId);
            return { success: true };
        } catch (error) {
            console.error('Error during logout:', error);
            throw error;
        }
    }

    // Delete user account
    async deleteAccount(userId) {
        try {
            // First get all campaigns to clean up files
            const campaignsQuery = 'SELECT resume_path FROM campaigns WHERE user_id = $1 AND resume_path IS NOT NULL';
            const campaigns = await query(campaignsQuery, [userId]);
            
            // Clean up resume files (optional - implement if needed)
            // for (const campaign of campaigns.rows) {
            //     if (campaign.resume_path && fs.existsSync(campaign.resume_path)) {
            //         fs.unlinkSync(campaign.resume_path);
            //     }
            // }
            
            // Delete all user data (campaigns will be deleted due to CASCADE)
            const result = await userRepository.deactivateUser(userId);
            
            if (result) {
                return { success: true };
            } else {
                return { success: false, error: 'User not found' };
            }
        } catch (error) {
            console.error('Error deleting account:', error);
            return { success: false, error: error.message };
        }
    }

    // Get user with email credentials
    async getUserWithEmailCredentials(userId) {
        try {
            return await userRepository.findByIdWithEmailCredentials(userId);
        } catch (error) {
            console.error('Error getting user with email credentials:', error);
            throw error;
        }
    }

    // Get user with Gemini credentials
    async getUserWithGeminiCredentials(userId) {
        try {
            return await userRepository.findByIdWithGeminiCredentials(userId);
        } catch (error) {
            console.error('Error getting user with Gemini credentials:', error);
            throw error;
        }
    }

    // Get user with all credentials
    async getUserWithAllCredentials(userId) {
        try {
            return await userRepository.findByIdWithAllCredentials(userId);
        } catch (error) {
            console.error('Error getting user with all credentials:', error);
            throw error;
        }
    }
}

export const authService = new AuthService();