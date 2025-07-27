// services/emailService.js (FIXED - Parameter order issue)
import fs from 'fs';
import { GoogleGenerativeAI } from '@google/generative-ai';
import puppeteer from 'puppeteer';
import nodemailer from 'nodemailer';
import axios from 'axios';
import dotenv from 'dotenv';
import { extractPDFText } from '../utils/pdfParser.js';
import { 
  createThreadingHeaders, 
  formatFollowUpSubject, 
  generateThreadId,
  extractDomain 
} from '../utils/emailThreading.js';
import { authService } from './authService.js';

// Load environment variables
dotenv.config();

// Circuit breaker for handling API failures
class CircuitBreaker {
    constructor(threshold = 5, timeout = 60000) {
        this.threshold = threshold;
        this.timeout = timeout;
        this.failureCount = 0;
        this.lastFailureTime = null;
        this.state = 'CLOSED'; // CLOSED, OPEN, HALF_OPEN
    }

    async call(fn) {
        if (this.state === 'OPEN') {
            if (Date.now() - this.lastFailureTime > this.timeout) {
                this.state = 'HALF_OPEN';
                console.log('Circuit breaker moving to HALF_OPEN state');
            } else {
                throw new Error('Circuit breaker is OPEN - service temporarily unavailable');
            }
        }

        try {
            const result = await fn();
            this.reset();
            return result;
        } catch (error) {
            this.recordFailure();
            throw error;
        }
    }

    recordFailure() {
        this.failureCount++;
        this.lastFailureTime = Date.now();
        if (this.failureCount >= this.threshold) {
            this.state = 'OPEN';
            console.log(`Circuit breaker OPEN after ${this.failureCount} failures`);
        }
    }

    reset() {
        if (this.failureCount > 0) {
            console.log('Circuit breaker reset - service recovered');
        }
        this.failureCount = 0;
        this.lastFailureTime = null;
        this.state = 'CLOSED';
    }
}

// Create circuit breaker instance
const aiCircuitBreaker = new CircuitBreaker(3, 120000);

// Enhanced AI service with user-based API keys
class AIService {
    constructor() {
        this.userGenAIInstances = new Map(); // Cache user-specific Gemini instances
        this.requestCount = 0;
        this.lastRequestTime = 0;
        this.minRequestInterval = 1000;
    }

    // Get or create Gemini AI instance for a specific user
    async getGeminiInstance(userId) {
        try {
            // Validate userId is actually a number/string that can be an ID
            if (!userId || (typeof userId !== 'number' && typeof userId !== 'string') || 
                (typeof userId === 'string' && userId.length > 50)) {
                console.error('❌ Invalid userId provided to getGeminiInstance:', typeof userId, userId?.length);
                throw new Error('Invalid user ID provided');
            }

            console.log(`🔍 Getting Gemini instance for user: ${userId} (type: ${typeof userId})`);

            // Check cache first
            if (this.userGenAIInstances.has(userId)) {
                console.log(`✅ Using cached Gemini instance for user ${userId}`);
                return this.userGenAIInstances.get(userId);
            }

            // Get user's Gemini API key
            const user = await authService.getUserWithGeminiCredentials(userId);
            
            if (!user || !user.gemini_api_key) {
                // Fallback to environment variable if user doesn't have API key
                if (process.env.GEMINI_API_KEY) {
                    console.log(`🔄 Using fallback Gemini API for user ${userId}`);
                    const fallbackGenAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
                    this.userGenAIInstances.set(userId, fallbackGenAI);
                    return fallbackGenAI;
                } else {
                    throw new Error('No Gemini API key available for user or in environment');
                }
            }

            // Create instance with user's API key
            console.log(`✅ Using user's Gemini API for user ${userId}`);
            const genAI = new GoogleGenerativeAI(user.gemini_api_key);
            
            // Cache the instance
            this.userGenAIInstances.set(userId, genAI);
            
            return genAI;
        } catch (error) {
            console.error('Failed to get Gemini instance for user:', userId, error);
            throw error;
        }
    }

    // Clear cached instance for a user (useful when API key is updated)
    clearUserInstance(userId) {
        this.userGenAIInstances.delete(userId);
        console.log(`🗑️ Cleared Gemini instance cache for user ${userId}`);
    }

    // Rate limiting helper
    async rateLimit() {
        const now = Date.now();
        const timeSinceLastRequest = now - this.lastRequestTime;
        
        if (timeSinceLastRequest < this.minRequestInterval) {
            const waitTime = this.minRequestInterval - timeSinceLastRequest;
            console.log(`Rate limiting: waiting ${waitTime}ms`);
            await new Promise(resolve => setTimeout(resolve, waitTime));
        }
        
        this.lastRequestTime = Date.now();
        this.requestCount++;
    }

    // Retry logic with exponential backoff
    async retryWithBackoff(fn, maxRetries = 3, baseDelay = 1000) {
        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            try {
                await this.rateLimit();
                return await fn();
            } catch (error) {
                console.log(`Attempt ${attempt}/${maxRetries} failed:`, error.message);
                
                if (attempt === maxRetries) {
                    throw error;
                }

                if (error.status === 503 || error.message.includes('overloaded') || 
                    error.message.includes('rate limit') || error.message.includes('quota')) {
                    
                    const delay = baseDelay * Math.pow(2, attempt - 1) + Math.random() * 1000;
                    console.log(`Retrying in ${delay.toFixed(0)}ms...`);
                    await new Promise(resolve => setTimeout(resolve, delay));
                } else {
                    throw error;
                }
            }
        }
    }

    // Generate content using user-specific or fallback Gemini instance
    async generateContent(userId, prompt, options = {}) {
        return await aiCircuitBreaker.call(async () => {
            return await this.retryWithBackoff(async () => {
                const genAI = await this.getGeminiInstance(userId);
                
                const model = genAI.getGenerativeModel({ 
                    model: options.model || 'gemini-1.5-flash',
                    generationConfig: {
                        temperature: options.temperature || 0.7,
                        topK: options.topK || 40,
                        topP: options.topP || 0.95,
                        maxOutputTokens: options.maxOutputTokens || 2048,
                    }
                });

                const result = await model.generateContent(prompt);
                const response = await result.response;
                return response.text();
            });
        });
    }

    // Health check for AI service
    async healthCheck(userId = null) {
        try {
            const testPrompt = "Return only the text: 'API is working'";
            
            if (userId) {
                await this.generateContent(userId, testPrompt);
            } else if (process.env.GEMINI_API_KEY) {
                // Test fallback API
                const fallbackGenAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
                const model = fallbackGenAI.getGenerativeModel({ model: 'gemini-1.5-flash' });
                const result = await model.generateContent(testPrompt);
                await result.response;
            }
            
            return { 
                status: 'healthy', 
                ai_service: 'operational',
                circuit_breaker: aiCircuitBreaker.state,
                request_count: this.requestCount
            };
        } catch (error) {
            return { 
                status: 'degraded', 
                ai_service: 'error',
                circuit_breaker: aiCircuitBreaker.state,
                error: error.message,
                request_count: this.requestCount
            };
        }
    }
}

// Create AI service instance
const aiService = new AIService();

class EmailService {
    constructor() {
        this.requestCount = 0;
        this.lastRequestTime = 0;
        this.minRequestInterval = 1000;
    }

    // Test email credentials
    async testEmailCredentials(email, password) {
        try {
            const transporter = nodemailer.createTransport({
                service: 'gmail',
                auth: {
                    user: email,
                    pass: password
                },
                timeout: 10000
            });

            await transporter.verify();
            console.log('✅ Email credentials verified successfully');
            return true;
        } catch (error) {
            console.error('❌ Email credentials test failed:', error);
            return false;
        }
    }

    // Create email transporter for user's Gmail
    createUserEmailTransporter(userEmail, userAppPassword) {
        console.log(`🔧 Creating Gmail transporter for: ${userEmail}`);
        return nodemailer.createTransport({
            service: 'gmail',
            auth: {
                user: userEmail,
                pass: userAppPassword
            },
            timeout: 30000,
            connectionTimeout: 30000,
            greetingTimeout: 30000,
            socketTimeout: 30000,
            tls: {
                rejectUnauthorized: false
            }
        });
    }

    // Create fallback email transporter (environment email)
    createFallbackEmailTransporter() {
        return nodemailer.createTransport({
            service: 'gmail',
            auth: {
                user: process.env.EMAIL_USER,
                pass: process.env.EMAIL_PASS
            }
        });
    }

    // Generate fallback email template
    generateFallbackEmail(companyInfo, senderInfo, jobTitle, recipientName) {
        const subject = `Application for ${jobTitle} Position at ${companyInfo.name}`;
        
        // Ensure senderInfo has default values
        const safeSenderInfo = {
            fullName: senderInfo?.fullName || "Job Seeker",
            email: senderInfo?.email || "",
            phone: senderInfo?.phone || "",
            currentTitle: senderInfo?.currentTitle || "Software Developer",
            yearsOfExperience: senderInfo?.yearsOfExperience || "2 years",
            keySkills: senderInfo?.keySkills || ["Programming", "Problem Solving", "Communication"],
            currentCompany: senderInfo?.currentCompany || "Previous Company",
            education: senderInfo?.education || "Bachelor's Degree",
            location: senderInfo?.location || ""
        };

        const body = `Dear ${recipientName || 'Hiring Manager'},

I am writing to express my strong interest in the ${jobTitle} position at ${companyInfo.name}. As a ${safeSenderInfo.currentTitle} with ${safeSenderInfo.yearsOfExperience} of experience, I believe I would be a valuable addition to your team.

My technical expertise includes ${safeSenderInfo.keySkills.slice(0, 3).join(', ')}, which aligns well with the requirements for this role. In my current position at ${safeSenderInfo.currentCompany}, I have successfully contributed to various projects that have enhanced my problem-solving abilities and technical skills.

I am particularly drawn to ${companyInfo.name} because of your reputation in the industry and commitment to innovation. I would welcome the opportunity to discuss how my background and enthusiasm can contribute to your team's continued success.

I have attached my resume for your review and would be happy to provide any additional information you may need. Thank you for considering my application.

Best regards,
${safeSenderInfo.fullName}
${safeSenderInfo.email}
${safeSenderInfo.phone}`;

        return `Subject: ${subject}\n\n${body}`;
    }

    // Extract sender information from resume using user's AI
    async extractSenderInfo(userId, resumeText) {
        try {
            console.log(`🔍 Extracting sender info for user: ${userId} (type: ${typeof userId})`);
            
            const prompt = `
Extract the following information from this resume text and return it as a JSON object:

Resume Text:
${resumeText}

Please extract:
1. Full name
2. Email address
3. Phone number
4. Current title/position
5. Years of experience (estimate if not explicit)
6. Key skills (top 5)
7. Current/most recent company
8. Education (highest degree)
9. Location/city

Return ONLY a valid JSON object with these fields:
{
    "fullName": "extracted name",
    "email": "extracted email",
    "phone": "extracted phone",
    "currentTitle": "extracted title",
    "yearsOfExperience": "X years",
    "keySkills": ["skill1", "skill2", "skill3", "skill4", "skill5"],
    "currentCompany": "extracted company",
    "education": "extracted education",
    "location": "extracted location"
}

If any information is not found, use empty string or empty array for that field.
`;

            const response = await aiService.generateContent(userId, prompt);
            
            try {
                const jsonMatch = response.match(/\{[\s\S]*\}/);
                if (jsonMatch) {
                    const parsed = JSON.parse(jsonMatch[0]);
                    console.log('✅ Successfully extracted sender info from resume');
                    return parsed;
                }
            } catch (e) {
                console.error('Error parsing JSON from AI response:', e);
            }
            
            return this.getDefaultSenderInfo();
        } catch (error) {
            console.error('Error extracting sender info:', error);
            return this.getDefaultSenderInfo();
        }
    }

    // Default sender info structure
    getDefaultSenderInfo() {
        return {
            fullName: "Job Seeker",
            email: "",
            phone: "",
            currentTitle: "",
            yearsOfExperience: "",
            keySkills: [],
            currentCompany: "",
            education: "",
            location: ""
        };
    }

    // Company research function using web scraping
    async researchCompany(companyName, companyWebsite) {
        let browser;
        try {
            browser = await puppeteer.launch({ 
                headless: true,
                args: ['--no-sandbox', '--disable-setuid-sandbox']
            });
            const page = await browser.newPage();
            
            const companyInfo = {
                name: companyName,
                website: companyWebsite,
                description: '',
                industry: '',
                size: '',
                recentNews: [],
                keyPeople: [],
                technologies: [],
                values: [],
                careers: ''
            };

            if (companyWebsite) {
                try {
                    await page.goto(companyWebsite, { 
                        waitUntil: 'networkidle2', 
                        timeout: 30000 
                    });
                    
                    const aboutSelectors = [
                        'meta[name="description"]',
                        '.about-section',
                        '#about',
                        '.company-description',
                        '.hero-description'
                    ];
                    
                    for (const selector of aboutSelectors) {
                        try {
                            const element = await page.$(selector);
                            if (element) {
                                const text = await page.evaluate(el => el.textContent || el.content, element);
                                if (text && text.length > 50) {
                                    companyInfo.description = text.substring(0, 500);
                                    break;
                                }
                            }
                        } catch (e) {
                            // Continue to next selector
                        }
                    }

                    const careerLinks = await page.evaluate(() => {
                        const links = Array.from(document.querySelectorAll('a'));
                        return links
                            .filter(link => /career|job|hiring|work|join/i.test(link.textContent))
                            .map(link => link.href)
                            .slice(0, 3);
                    });
                    
                    if (careerLinks.length > 0) {
                        companyInfo.careers = careerLinks[0];
                    }

                } catch (error) {
                    console.log('Error scraping company website:', error.message);
                }
            }

            return companyInfo;

        } catch (error) {
            console.error('Error in company research:', error);
            return {
                name: companyName,
                website: companyWebsite,
                description: '',
                industry: '',
                size: '',
                recentNews: [],
                keyPeople: [],
                technologies: [],
                values: [],
                careers: ''
            };
        } finally {
            if (browser) {
                await browser.close();
            }
        }
    }

    // Extract text from PDF resume
    async extractResumeText(filePath) {
        try {
            console.log(`Attempting to extract text from: ${filePath}`);
            const text = await extractPDFText(filePath);
            console.log(`Extracted text length: ${text.length}`);
            return text;
        } catch (error) {
            console.error('Error extracting resume text:', error);
            return '';
        }
    }

    // Generate personalized email using user's Gemini AI with fallback
    async generatePersonalizedEmail(userId, companyInfo, resumeText, senderInfo, emailType, jobTitle, recipientName, additionalInfo) {
        try {
            console.log(`🤖 Generating personalized email for user: ${userId} (type: ${typeof userId})`);
            
            // Ensure senderInfo has default values to prevent errors
            const safeSenderInfo = {
                fullName: senderInfo?.fullName || "Job Seeker",
                email: senderInfo?.email || "",
                phone: senderInfo?.phone || "",
                currentTitle: senderInfo?.currentTitle || "Software Developer",
                yearsOfExperience: senderInfo?.yearsOfExperience || "2 years",
                keySkills: senderInfo?.keySkills || ["Programming", "Problem Solving", "Communication"],
                currentCompany: senderInfo?.currentCompany || "Previous Company",
                education: senderInfo?.education || "Bachelor's Degree",
                location: senderInfo?.location || ""
            };

            const prompt = `
You are writing a professional cold email for a job application. Write a compelling, natural email that reads like a senior developer wrote it personally.

**ABSOLUTE RULES:**
1. NO brackets [ ] anywhere in the email
2. NO placeholder text like "mention X" or "add Y" 
3. NO examples in parentheses like "(e.g., ...)"
4. NO template language or AI patterns
5. Write concrete, specific statements only
6. Make every sentence complete and actionable

**SENDER DETAILS:**
Name: ${safeSenderInfo.fullName}
Current Role: ${safeSenderInfo.currentTitle} at ${safeSenderInfo.currentCompany}
Skills: ${safeSenderInfo.keySkills.join(', ')}
Education: ${safeSenderInfo.education}

**TARGET:**
Company: ${companyInfo.name}
Position: ${jobTitle}
Recipient: ${recipientName || 'Hiring Manager'}

**RESUME CONTENT TO EXTRACT SPECIFICS:**
${resumeText}

**COMPANY CONTEXT:**
${companyInfo.description}

**EMAIL WRITING INSTRUCTIONS:**

**Subject Line Format:**
"Application for ${jobTitle} Position at ${companyInfo.name}"

**Email Structure (180-200 words):**

1. **Opening:** Direct introduction with your current role
2. **Technical Highlight:** 1-2 most impressive technical achievements from resume
3. **Company Connection:** Why this specific company interests you (based on their business)
4. **Value Proposition:** What specific value you bring
5. **Call to Action:** Professional request for consideration with resume mention
6. **Signature:** Full contact details

**Writing Style:**
- Confident but humble
- Technical but accessible
- Professional but personable
- Specific numbers and technologies
- No buzzwords or corporate speak
- Natural conversation flow

**CRITICAL:** Extract real projects from the resume content. If the resume mentions specific technologies, systems, or achievements, use those exact details. Do NOT make up percentages or generic accomplishments.

Write the complete email now:

Subject: Application for ${jobTitle} Position at ${companyInfo.name}

Dear ${recipientName || 'Hiring Manager'},

[Write natural, impressive email body]

Best regards,
${safeSenderInfo.fullName}
${safeSenderInfo.email}  
${safeSenderInfo.phone}

REMEMBER: Zero placeholders, zero brackets, zero examples - only complete, natural sentences.
`;

            try {
                const aiResponse = await aiService.generateContent(userId, prompt);
                console.log('✅ Email generated successfully with user AI');
                return aiResponse;
            } catch (aiError) {
                console.error('User AI generation failed:', aiError.message);
                
                // If user's API key fails, try fallback
                if (aiError.message && aiError.message.includes('API_KEY_INVALID') && process.env.GEMINI_API_KEY) {
                    console.log('🔄 User API key invalid, trying fallback...');
                    aiService.clearUserInstance(userId);
                    
                    try {
                        const fallbackResponse = await aiService.generateContent(userId, prompt);
                        console.log('✅ Email generated with fallback AI');
                        return fallbackResponse;
                    } catch (fallbackError) {
                        console.error('Fallback AI also failed:', fallbackError.message);
                    }
                }
                
                console.log('📝 Using fallback email template...');
                const fallbackEmail = this.generateFallbackEmail(companyInfo, safeSenderInfo, jobTitle, recipientName);
                return fallbackEmail;
            }
        } catch (error) {
            console.error('Error in generatePersonalizedEmail:', error);
            
            // Ensure we have safe sender info for fallback
            const safeSenderInfo = {
                fullName: senderInfo?.fullName || "Job Seeker",
                email: senderInfo?.email || "",
                phone: senderInfo?.phone || "",
                currentTitle: senderInfo?.currentTitle || "Software Developer",
                yearsOfExperience: senderInfo?.yearsOfExperience || "2 years",
                keySkills: senderInfo?.keySkills || ["Programming", "Problem Solving", "Communication"],
                currentCompany: senderInfo?.currentCompany || "Previous Company",
                education: senderInfo?.education || "Bachelor's Degree",
                location: senderInfo?.location || ""
            };
            
            return this.generateFallbackEmail(companyInfo, safeSenderInfo, jobTitle, recipientName);
        }
    }

    // Send email function with threading support and user's email credentials
    async sendEmail(recipientEmail, subject, body, senderInfo, resumePath, userId, userEmailCredentials = null, threadingOptions = {}) {
        try {
            let transporter;
            let fromEmail;
            let method;

            // Get user's email credentials from database if not provided
            if (!userEmailCredentials) {
                const user = await authService.getUserWithEmailCredentials(userId);
                if (user && user.email_password) {
                    userEmailCredentials = {
                        email: user.email,
                        appPassword: user.email_password
                    };
                }
            }

            // Try to use user's email credentials if available
            if (userEmailCredentials && userEmailCredentials.email && userEmailCredentials.appPassword) {
                console.log(`🔄 Attempting to send email via user's Gmail: ${userEmailCredentials.email}`);
                transporter = this.createUserEmailTransporter(userEmailCredentials.email, userEmailCredentials.appPassword);
                fromEmail = userEmailCredentials.email;
                method = 'user_gmail';
            } else {
                console.log('🔄 Using fallback SMTP email...');
                transporter = this.createFallbackEmailTransporter();
                fromEmail = process.env.EMAIL_USER;
                method = 'fallback_smtp';
            }

            // Generate threading headers with emailReferences
            const threadHeaders = createThreadingHeaders({
                senderEmail: senderInfo.email || fromEmail,
                originalMessageId: threadingOptions.originalMessageId || null,
                threadId: threadingOptions.threadId || null,
                emailReferences: threadingOptions.emailReferences || '',
                isReply: threadingOptions.isReply || false
            });

            console.log('📧 Threading headers:', threadHeaders);

            const mailOptions = {
                from: `${senderInfo.fullName} <${fromEmail}>`,
                to: recipientEmail,
                subject: subject,
                text: body,
                html: body.replace(/\n/g, '<br>'),
                replyTo: senderInfo.email,
                // Add threading headers
                headers: {
                    ...threadHeaders,
                    'X-Campaign-Type': threadingOptions.campaignType || 'original',
                    'X-Follow-Up-Number': threadingOptions.followUpNumber || 0
                },
                attachments: resumePath ? [
                    {
                        filename: `${senderInfo.fullName.replace(/\s+/g, '_')}_Resume.pdf`,
                        path: resumePath,
                        contentType: 'application/pdf'
                    }
                ] : []
            };

            // Test the connection first
            await transporter.verify();

            const info = await transporter.sendMail(mailOptions);
            console.log(`✅ Email sent successfully via ${method}:`);
            console.log(`   From: ${fromEmail}`);
            console.log(`   Reply-To: ${senderInfo.email}`);
            console.log(`   Message ID: ${info.messageId}`);
            console.log(`   Threading: ${threadHeaders['Message-ID']}`);
            
            return { 
                success: true, 
                messageId: info.messageId,
                threadingMessageId: threadHeaders['Message-ID'],
                threadId: threadHeaders['X-Thread-ID'],
                method: method,
                senderEmail: fromEmail,
                replyToEmail: senderInfo.email
            };
        } catch (error) {
            console.error('❌ Error sending email:', error);
            
            if (error.code === 'EAUTH') {
                return { 
                    success: false, 
                    error: 'Email authentication failed. Please check your app password.',
                    needsCredentials: true
                };
            }
            
            return { 
                success: false, 
                error: error.message 
            };
        }
    }

    // Generate follow-up email with proper threading using user's AI
    async generateFollowUpEmail(userId, originalEmail, companyName, jobTitle, senderInfo, followUpNumber, originalSubject = null) {
        try {
            // Extract original subject if not provided
            let extractedSubject = originalSubject;
            if (!extractedSubject && originalEmail) {
                const subjectMatch = originalEmail.match(/Subject:\s*(.+)/);
                extractedSubject = subjectMatch ? subjectMatch[1].trim() : `${jobTitle} Application`;
            }

            const prompt = `
Generate a polite follow-up email (follow-up #${followUpNumber}) for a job application. 

**Sender Information:**
- Full Name: ${senderInfo.fullName}
- Email: ${senderInfo.email}
- Phone: ${senderInfo.phone}
- Current Title: ${senderInfo.currentTitle}

**Original Email Context:**
${originalEmail}

**Details:**
- Company: ${companyName}
- Position: ${jobTitle}
- Follow-up Number: ${followUpNumber}
- Original Subject: ${extractedSubject || 'Job Application'}

**Instructions:**
1. Be polite and professional
2. Reference the original email briefly
3. Reiterate interest in the position
4. Add new value (recent achievement, relevant news, etc.)
5. Keep it shorter than the original (100-150 words)
6. Include appropriate subject line with "Re: " prefix for threading
7. Be respectful of their time
8. Use sender's actual name and contact info

**Output Format:**
Subject: Re: ${extractedSubject || `${jobTitle} position`}

Dear Hiring Manager,

[Email body]

Best regards,
${senderInfo.fullName}
${senderInfo.email}
${senderInfo.phone}
`;

            try {
                const aiResponse = await aiService.generateContent(userId, prompt);
                console.log('✅ Follow-up email generated successfully with user AI');
                return aiResponse;
            } catch (aiError) {
                console.error('User AI generation failed for follow-up:', aiError.message);
                
                // Fallback follow-up template with proper subject formatting
                const replySubject = formatFollowUpSubject(extractedSubject || `${jobTitle} Application`, followUpNumber);
                
                const fallbackFollowUp = `Subject: ${replySubject}

Dear Hiring Manager,

I wanted to follow up on my application for the ${jobTitle} position at ${companyName} that I submitted recently. I remain very interested in this opportunity and believe my skills would be a great fit for your team.

I understand you receive many applications, and I appreciate your time in reviewing mine. If you need any additional information or would like to schedule a conversation, I'm available at your convenience.

Thank you for your consideration.

Best regards,
${senderInfo.fullName}
${senderInfo.email}
${senderInfo.phone}`;

                return fallbackFollowUp;
            }
        } catch (error) {
            console.error('Error generating follow-up email:', error);
            return 'Error generating follow-up email. Please try again.';
        }
    }

    // Clear user's AI instance cache when API key is updated
    clearUserAICache(userId) {
        aiService.clearUserInstance(userId);
        console.log(`🗑️ Cleared AI cache for user ${userId}`);
    }

    // Health check method
    async healthCheck(userId = null) {
        return await aiService.healthCheck(userId);
    }

    // Test user's Gemini API key
    async testUserGeminiAPI(userId) {
        try {
            const testPrompt = "Return only the text: 'User API is working'";
            const response = await aiService.generateContent(userId, testPrompt);
            return { 
                success: true, 
                message: 'User Gemini API is working',
                response: response
            };
        } catch (error) {
            return { 
                success: false, 
                error: error.message 
            };
        }
    }
}

export const emailService = new EmailService();