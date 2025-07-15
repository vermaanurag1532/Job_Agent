import fs from 'fs';
import { GoogleGenerativeAI } from '@google/generative-ai';
import puppeteer from 'puppeteer';
import nodemailer from 'nodemailer';
import axios from 'axios';
import dotenv from 'dotenv';
import { extractPDFText } from '../utils/pdfParser.js';

// Load environment variables
dotenv.config();

// Debug: Check if API key is loaded
console.log('Gemini API Key loaded:', process.env.GEMINI_API_KEY ? 'Yes' : 'No');

// Initialize Google Generative AI with error handling
let genAI;
try {
    if (!process.env.GEMINI_API_KEY) {
        throw new Error('GEMINI_API_KEY is not set in environment variables');
    }
    genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    console.log('Google Generative AI initialized successfully');
} catch (error) {
    console.error('Failed to initialize Google Generative AI:', error);
}

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
        this.state = 'CLOSED';
    }
}

// Create circuit breaker instance
const aiCircuitBreaker = new CircuitBreaker(3, 120000); // 3 failures, 2 minute timeout

class EmailService {
    constructor() {
        this.requestCount = 0;
        this.lastRequestTime = 0;
        this.minRequestInterval = 1000; // 1 second between requests
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

                // Check if it's a retryable error
                if (error.status === 503 || error.message.includes('overloaded') || 
                    error.message.includes('rate limit') || error.message.includes('quota')) {
                    
                    const delay = baseDelay * Math.pow(2, attempt - 1) + Math.random() * 1000;
                    console.log(`Retrying in ${delay.toFixed(0)}ms...`);
                    await new Promise(resolve => setTimeout(resolve, delay));
                } else {
                    // Non-retryable error
                    throw error;
                }
            }
        }
    }

    // Enhanced AI generation with fallback
    async generateWithAI(prompt, options = {}) {
        return await aiCircuitBreaker.call(async () => {
            return await this.retryWithBackoff(async () => {
                if (!genAI) {
                    throw new Error('Google Generative AI not initialized');
                }

                const model = genAI.getGenerativeModel({ 
                    model: options.model || "gemini-1.5-flash",
                    generationConfig: {
                        temperature: options.temperature || 0.7,
                        topP: options.topP || 0.8,
                        topK: options.topK || 40,
                        maxOutputTokens: options.maxOutputTokens || 2048,
                    }
                });

                const result = await model.generateContent(prompt);
                const response = await result.response;
                return response.text();
            });
        });
    }

    // Generate fallback email template
    generateFallbackEmail(companyInfo, senderInfo, jobTitle, recipientName) {
        const subject = `Application for ${jobTitle} Position at ${companyInfo.name}`;
        
        const body = `Dear ${recipientName || 'Hiring Manager'},

I am writing to express my strong interest in the ${jobTitle} position at ${companyInfo.name}. As a ${senderInfo.currentTitle} with ${senderInfo.yearsOfExperience} of experience, I believe I would be a valuable addition to your team.

My technical expertise includes ${senderInfo.keySkills.slice(0, 3).join(', ')}, which aligns well with the requirements for this role. In my current position at ${senderInfo.currentCompany}, I have successfully contributed to various projects that have enhanced my problem-solving abilities and technical skills.

I am particularly drawn to ${companyInfo.name} because of your reputation in the industry and commitment to innovation. I would welcome the opportunity to discuss how my background and enthusiasm can contribute to your team's continued success.

I have attached my resume for your review and would be happy to provide any additional information you may need. Thank you for considering my application.

Best regards,
${senderInfo.fullName}
${senderInfo.email}
${senderInfo.phone}`;

        return `Subject: ${subject}\n\n${body}`;
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
            tls: {
                rejectUnauthorized: false
            }
        });
    }

    // Create fallback email transporter (your email)
    createFallbackEmailTransporter() {
        return nodemailer.createTransport({
            service: 'gmail',
            auth: {
                user: process.env.EMAIL_USER,
                pass: process.env.EMAIL_PASS
            }
        });
    }

    // Extract sender information from resume
    async extractSenderInfo(resumeText) {
        try {
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

            const response = await this.generateWithAI(prompt);
            
            // Try to parse JSON from the response
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
            
            // Return default structure if parsing fails
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

            // If website provided, scrape it
            if (companyWebsite) {
                try {
                    await page.goto(companyWebsite, { 
                        waitUntil: 'networkidle2', 
                        timeout: 30000 
                    });
                    
                    // Extract company description
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

                    // Try to find careers/jobs page
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

    // Generate personalized email using Gemini AI with fallback
    async generatePersonalizedEmail(companyInfo, resumeText, senderInfo, emailType, jobTitle, recipientName, additionalInfo) {
        try {
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
Name: ${senderInfo.fullName}
Current Role: ${senderInfo.currentTitle} at ${senderInfo.currentCompany}
Skills: ${senderInfo.keySkills.join(', ')}
Education: ${senderInfo.education}

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
${senderInfo.fullName}
${senderInfo.email}  
${senderInfo.phone}

REMEMBER: Zero placeholders, zero brackets, zero examples - only complete, natural sentences.
`;

            // Try AI generation first
            try {
                const aiResponse = await this.generateWithAI(prompt);
                console.log('✅ Email generated successfully with AI');
                return aiResponse;
            } catch (aiError) {
                console.error('AI generation failed:', aiError.message);
                
                // Use fallback template
                console.log('📝 Using fallback email template...');
                const fallbackEmail = this.generateFallbackEmail(companyInfo, senderInfo, jobTitle, recipientName);
                return fallbackEmail;
            }
        } catch (error) {
            console.error('Error in generatePersonalizedEmail:', error);
            
            // Final fallback
            return this.generateFallbackEmail(companyInfo, senderInfo, jobTitle, recipientName);
        }
    }

    // Send email function with user's credentials
    async sendEmail(recipientEmail, subject, body, senderInfo, resumePath, userId, userEmailCredentials = null) {
        try {
            let transporter;
            let fromEmail;
            let method;

            // Try to use user's email credentials if provided
            if (userEmailCredentials && userEmailCredentials.email && userEmailCredentials.appPassword) {
                console.log(`🔄 Attempting to send email via user's Gmail: ${userEmailCredentials.email}`);
                transporter = this.createUserEmailTransporter(userEmailCredentials.email, userEmailCredentials.appPassword);
                fromEmail = userEmailCredentials.email;
                method = 'user_gmail';
            } else {
                // Fallback to your email
                console.log('🔄 Using fallback SMTP email...');
                transporter = this.createFallbackEmailTransporter();
                fromEmail = process.env.EMAIL_USER;
                method = 'fallback_smtp';
            }

            const mailOptions = {
                from: `${senderInfo.fullName} <${fromEmail}>`,
                to: recipientEmail,
                subject: subject,
                text: body,
                html: body.replace(/\n/g, '<br>'),
                replyTo: senderInfo.email, // Always set reply-to as user's actual email
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
            
            return { 
                success: true, 
                messageId: info.messageId, 
                method: method,
                senderEmail: fromEmail,
                replyToEmail: senderInfo.email
            };
        } catch (error) {
            console.error('❌ Error sending email:', error);
            
            // Provide specific error messages
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

    // Generate follow-up email
    async generateFollowUpEmail(originalEmail, companyName, jobTitle, senderInfo, followUpNumber) {
        try {
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

**Instructions:**
1. Be polite and professional
2. Reference the original email briefly
3. Reiterate interest in the position
4. Add new value (recent achievement, relevant news, etc.)
5. Keep it shorter than the original (100-150 words)
6. Include appropriate subject line
7. Be respectful of their time
8. Use sender's actual name and contact info

**Output Format:**
Subject: [Subject line]

Dear Hiring Manager,

[Email body]

Best regards,
${senderInfo.fullName}
${senderInfo.email}
${senderInfo.phone}
`;

            try {
                const aiResponse = await this.generateWithAI(prompt);
                console.log('✅ Follow-up email generated successfully with AI');
                return aiResponse;
            } catch (aiError) {
                console.error('AI generation failed for follow-up:', aiError.message);
                
                // Fallback follow-up template
                const fallbackFollowUp = `Subject: Following up on ${jobTitle} Application

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

    // Health check method
    async healthCheck() {
        try {
            const testPrompt = "Return only the text: 'API is working'";
            const response = await this.generateWithAI(testPrompt);
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

export const emailService = new EmailService();