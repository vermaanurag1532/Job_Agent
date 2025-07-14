import passport from 'passport';
import { Strategy as GoogleStrategy } from 'passport-google-oauth20';
import { Strategy as JwtStrategy, ExtractJwt } from 'passport-jwt';
import { userRepository } from '../repositories/userRepository.js';
import dotenv from 'dotenv';

dotenv.config();

// Simple Google OAuth Strategy - Only for basic profile
passport.use(new GoogleStrategy({
    clientID: process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    callbackURL: process.env.GOOGLE_CALLBACK_URL,
    scope: ['profile', 'email']
}, async (accessToken, refreshToken, profile, done) => {
    try {
        console.log('Google OAuth callback triggered for:', profile.emails?.[0]?.value || 'unknown email');
        
        // Safely extract email
        const email = profile.emails && profile.emails.length > 0 
            ? profile.emails[0].value 
            : null;

        if (!email) {
            console.error('❌ No email found in Google profile');
            return done(new Error('No email provided by Google'), null);
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

        console.log('✅ Processing user data:', {
            email: userData.email,
            googleUserId: userData.googleUserId,
            fullName: userData.fullName
        });

        const user = await userRepository.findOrCreateUser(userData);
        
        return done(null, user);
    } catch (error) {
        console.error('Google OAuth error:', error);
        return done(error, null);
    }
}));

// JWT Strategy (unchanged)
passport.use(new JwtStrategy({
    jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
    secretOrKey: process.env.JWT_SECRET
}, async (payload, done) => {
    try {
        const user = await userRepository.findById(payload.userId);
        
        if (user) {
            return done(null, user);
        } else {
            return done(null, false);
        }
    } catch (error) {
        console.error('JWT Strategy error:', error);
        return done(error, false);
    }
}));

// Serialize user for session
passport.serializeUser((user, done) => {
    done(null, user.user_id);
});

// Deserialize user from session
passport.deserializeUser(async (id, done) => {
    try {
        const user = await userRepository.findById(id);
        done(null, user);
    } catch (error) {
        done(error, null);
    }
});

export default passport;