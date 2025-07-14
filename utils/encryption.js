import CryptoJS from 'crypto-js';
import dotenv from 'dotenv';

dotenv.config();

const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY;

export const encryptToken = (token) => {
    if (!token) return null;
    return CryptoJS.AES.encrypt(token, ENCRYPTION_KEY).toString();
};

export const decryptToken = (encryptedToken) => {
    if (!encryptedToken) return null;
    try {
        const bytes = CryptoJS.AES.decrypt(encryptedToken, ENCRYPTION_KEY);
        return bytes.toString(CryptoJS.enc.Utf8);
    } catch (error) {
        console.error('Token decryption failed:', error);
        return null;
    }
};