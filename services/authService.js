import jwt from 'jsonwebtoken';
import { userRepository } from '../repositories/userRepository.js';
import dotenv from 'dotenv';

dotenv.config();

class AuthService {
    // Generate JWT token
    generateToken(user) {
        const payload = {
            userId: user.user_id,
            email: user.email,
            fullName: user.full_name
        };

        return jwt.sign(payload, process.env.JWT_SECRET, {
            expiresIn: process.env.JWT_EXPIRES_IN || '7d'
        });
    }

    // Verify JWT token
    verifyToken(token) {
        try {
            return jwt.verify(token, process.env.JWT_SECRET);
        } catch (error) {
            throw new Error('Invalid or expired token');
        }
    }

    // Handle Google OAuth callback (legacy method - not used in current flow)
    async handleGoogleCallback(profile) {
        try {
            console.log('🔍 Profile data received:', {
                id: profile.id,
                displayName: profile.displayName,
                emails: profile.emails,
                photos: profile.photos
            });

            // Safely extract email
            const email = profile.emails && profile.emails.length > 0 
                ? profile.emails[0].value 
                : null;

            if (!email) {
                throw new Error('No email found in Google profile');
            }

            // Safely extract profile picture
            const profilePicture = profile.photos && profile.photos.length > 0 
                ? profile.photos[0].value 
                : null;

            const userData = {
                email: email,
                googleUserId: profile.id,
                fullName: profile.displayName || 'Google User',
                profilePicture: profilePicture
            };

            console.log('✅ Extracted user data:', userData);

            const user = await userRepository.findOrCreateUser(userData);
            const token = this.generateToken(user);

            return {
                user: {
                    id: user.user_id,
                    email: user.email,
                    fullName: user.full_name,
                    profilePicture: user.profile_picture,
                    createdAt: user.created_at,
                    lastLogin: user.last_login
                },
                token
            };
        } catch (error) {
            console.error('Error in Google callback:', error);
            throw error;
        }
    }

    // Get current user info
    async getCurrentUser(userId) {
        try {
            const user = await userRepository.findById(userId);
            if (!user) {
                throw new Error('User not found');
            }

            const stats = await userRepository.getUserStats(userId);

            return {
                user: {
                    id: user.user_id,
                    email: user.email,
                    fullName: user.full_name,
                    profilePicture: user.profile_picture,
                    createdAt: user.created_at,
                    lastLogin: user.last_login
                },
                stats
            };
        } catch (error) {
            console.error('Error getting current user:', error);
            throw error;
        }
    }

    // Get user statistics
    async getUserStats(userId) {
        try {
            const stats = await userRepository.getUserStats(userId);
            return stats;
        } catch (error) {
            console.error('Error getting user stats:', error);
            return {
                total_campaigns: 0,
                sent_campaigns: 0,
                failed_campaigns: 0,
                pending_campaigns: 0
            };
        }
    }

    // Logout user (token blacklisting would be implemented here if needed)
    async logout(userId) {
        try {
            // In a more robust implementation, you might want to:
            // 1. Add token to blacklist
            // 2. Clear session from database
            // 3. Log the logout event
            
            console.log(`User ${userId} logged out`);
            return { success: true };
        } catch (error) {
            console.error('Error during logout:', error);
            throw error;
        }
    }

    // Refresh token
    async refreshToken(oldToken) {
        try {
            const decoded = this.verifyToken(oldToken);
            const user = await userRepository.findById(decoded.userId);
            
            if (!user) {
                throw new Error('User not found');
            }

            const newToken = this.generateToken(user);
            return { token: newToken };
        } catch (error) {
            console.error('Error refreshing token:', error);
            throw error;
        }
    }
}

export const authService = new AuthService();