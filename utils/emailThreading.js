// utils/emailThreading.js
import { v4 as uuidv4 } from 'uuid';

/**
 * Generate a unique Message-ID for emails
 * @param {string} domain - Domain for the Message-ID (should be sender's domain)
 * @returns {string} - Properly formatted Message-ID
 */
export const generateMessageId = (domain = 'localhost') => {
  const timestamp = Date.now();
  const randomId = uuidv4().replace(/-/g, '');
  return `<${timestamp}.${randomId}@${domain}>`;
};

/**
 * Extract domain from email address
 * @param {string} email - Email address
 * @returns {string} - Domain part of the email
 */
export const extractDomain = (email) => {
  if (!email || !email.includes('@')) return 'localhost';
  return email.split('@')[1];
};

/**
 * Generate thread ID for grouping related emails
 * @param {string} campaignId - Campaign ID
 * @returns {string} - Thread ID
 */
export const generateThreadId = (campaignId) => {
  return `thread-${campaignId}`;
};

/**
 * Build References header for email threading
 * @param {string} originalMessageId - Original email's Message-ID
 * @param {string} previousReferences - Previous References header (for multi-level threading)
 * @returns {string} - References header value
 */
export const buildReferences = (originalMessageId, previousReferences = '') => {
  if (!originalMessageId) return '';
  
  if (previousReferences) {
    // Add the original message ID to existing references
    return `${previousReferences} ${originalMessageId}`;
  }
  
  return originalMessageId;
};

/**
 * Parse Message-ID from email headers
 * @param {Object} emailHeaders - Email headers object
 * @returns {string|null} - Extracted Message-ID or null
 */
export const parseMessageId = (emailHeaders) => {
  if (!emailHeaders) return null;
  
  // Handle different header formats
  const messageId = emailHeaders['message-id'] || 
                   emailHeaders['Message-ID'] || 
                   emailHeaders.messageId;
  
  return messageId || null;
};

/**
 * Create email headers for threading
 * @param {Object} options - Threading options
 * @param {string} options.senderEmail - Sender's email address
 * @param {string} options.originalMessageId - Original email's Message-ID (for replies)
 * @param {string} options.threadId - Thread ID for grouping
 * @param {string} options.emailReferences - Previous References header
 * @param {boolean} options.isReply - Whether this is a reply email
 * @returns {Object} - Email headers for threading
 */
export const createThreadingHeaders = ({
  senderEmail,
  originalMessageId = null,
  threadId = null,
  emailReferences = '',
  isReply = false
}) => {
  const domain = extractDomain(senderEmail);
  const messageId = generateMessageId(domain);
  
  const headers = {
    'Message-ID': messageId,
    'X-Thread-ID': threadId || generateThreadId('unknown')
  };
  
  if (isReply && originalMessageId) {
    headers['In-Reply-To'] = originalMessageId;
    headers['References'] = buildReferences(originalMessageId, emailReferences);
  }
  
  return headers;
};

/**
 * Extract email thread information from campaign
 * @param {Object} campaign - Campaign object
 * @returns {Object} - Thread information
 */
export const getThreadInfo = (campaign) => {
  return {
    messageId: campaign.message_id || null,
    inReplyTo: campaign.in_reply_to || null,
    emailReferences: campaign.email_references || '',
    threadId: campaign.thread_id || generateThreadId(campaign.id)
  };
};

/**
 * Format subject line for follow-up emails
 * @param {string} originalSubject - Original email subject
 * @param {number} followUpNumber - Follow-up number (1, 2, etc.)
 * @param {boolean} addRePrefix - Whether to add "Re: " prefix
 * @returns {string} - Formatted subject line
 */
export const formatFollowUpSubject = (originalSubject, followUpNumber, addRePrefix = true) => {
  // Remove existing "Re: " prefix to avoid "Re: Re: Re: " chains
  const cleanSubject = originalSubject.replace(/^Re:\s*/i, '');
  
  if (addRePrefix) {
    return `Re: ${cleanSubject}`;
  }
  
  // Alternative: Add follow-up indicator
  return `${cleanSubject} - Follow-up #${followUpNumber}`;
};

/**
 * Validate Message-ID format
 * @param {string} messageId - Message-ID to validate
 * @returns {boolean} - Whether the Message-ID is valid
 */
export const isValidMessageId = (messageId) => {
  if (!messageId || typeof messageId !== 'string') return false;
  
  // Basic Message-ID format: <local-part@domain>
  const messageIdRegex = /^<[^<>@]+@[^<>@]+>$/;
  return messageIdRegex.test(messageId);
};

/**
 * Clean and normalize Message-ID
 * @param {string} messageId - Raw Message-ID
 * @returns {string} - Cleaned Message-ID
 */
export const normalizeMessageId = (messageId) => {
  if (!messageId) return '';
  
  // Ensure Message-ID is wrapped in angle brackets
  const trimmed = messageId.trim();
  if (!trimmed.startsWith('<') || !trimmed.endsWith('>')) {
    return `<${trimmed}>`;
  }
  
  return trimmed;
};

export default {
  generateMessageId,
  extractDomain,
  generateThreadId,
  buildReferences,
  parseMessageId,
  createThreadingHeaders,
  getThreadInfo,
  formatFollowUpSubject,
  isValidMessageId,
  normalizeMessageId
};