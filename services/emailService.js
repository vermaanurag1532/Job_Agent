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
console.log('Email User loaded:', process.env.EMAIL_USER ? 'Yes' : 'No');

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

class EmailService {
    // Email transporter configuration
    createEmailTransporter() {
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
            if (!genAI) {
                throw new Error('Google Generative AI not initialized');
            }

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

            const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
            const result = await model.generateContent(prompt);
            const response = await result.response;
            const text = response.text();
            
            // Try to parse JSON from the response
            try {
                const jsonMatch = text.match(/\{[\s\S]*\}/);
                if (jsonMatch) {
                    return JSON.parse(jsonMatch[0]);
                }
            } catch (e) {
                console.error('Error parsing JSON from AI response:', e);
            }
            
            // Return default structure if parsing fails
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
        } catch (error) {
            console.error('Error extracting sender info:', error);
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
    }

    // Company research function using web scraping
    async researchCompany(companyName, companyWebsite) {
        let browser;
        try {
            browser = await puppeteer.launch({ headless: true });
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
                    await page.goto(companyWebsite, { waitUntil: 'networkidle2', timeout: 30000 });
                    
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

            // Search for recent news about the company
            try {
                if (process.env.GOOGLE_SEARCH_API_KEY && process.env.GOOGLE_SEARCH_ENGINE_ID) {
                    const newsQuery = `${companyName} company news recent`;
                    const newsResponse = await axios.get(`https://www.googleapis.com/customsearch/v1?key=${process.env.GOOGLE_SEARCH_API_KEY}&cx=${process.env.GOOGLE_SEARCH_ENGINE_ID}&q=${encodeURIComponent(newsQuery)}&num=3`);
                    
                    if (newsResponse.data.items) {
                        companyInfo.recentNews = newsResponse.data.items.map(item => ({
                            title: item.title,
                            snippet: item.snippet,
                            link: item.link
                        }));
                    }
                }
            } catch (error) {
                console.log('Error fetching company news:', error.message);
            }

            // Search for company information on LinkedIn
            try {
                if (process.env.GOOGLE_SEARCH_API_KEY && process.env.GOOGLE_SEARCH_ENGINE_ID) {
                    const linkedInQuery = `${companyName} site:linkedin.com/company`;
                    const linkedInResponse = await axios.get(`https://www.googleapis.com/customsearch/v1?key=${process.env.GOOGLE_SEARCH_API_KEY}&cx=${process.env.GOOGLE_SEARCH_ENGINE_ID}&q=${encodeURIComponent(linkedInQuery)}&num=1`);
                    
                    if (linkedInResponse.data.items && linkedInResponse.data.items[0]) {
                        const linkedInInfo = linkedInResponse.data.items[0];
                        companyInfo.industry = linkedInInfo.snippet;
                    }
                }
            } catch (error) {
                console.log('Error fetching LinkedIn info:', error.message);
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

    // Extract text from PDF resume - FIXED VERSION
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

    // Generate personalized email using Gemini AI
    async generatePersonalizedEmail(companyInfo, resumeText, senderInfo, emailType, jobTitle, recipientName, additionalInfo) {
        try {
            if (!genAI) {
                throw new Error('Google Generative AI not initialized');
            }

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

            const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
            const result = await model.generateContent(prompt);
            const response = await result.response;
            return response.text();
        } catch (error) {
            console.error('Error generating email:', error);
            return 'Error generating email. Please try again.';
        }
    }

    // Send email function with resume attachment
    async sendEmail(recipientEmail, subject, body, senderInfo, resumePath) {
        try {
            const transporter = this.createEmailTransporter();
            
            const mailOptions = {
                from: `${senderInfo.fullName} <${process.env.EMAIL_USER}>`,
                to: recipientEmail,
                subject: subject,
                text: body,
                html: body.replace(/\n/g, '<br>'),
                attachments: resumePath ? [
                    {
                        filename: `${senderInfo.fullName.replace(/\s+/g, '_')}_Resume.pdf`,
                        path: resumePath,
                        contentType: 'application/pdf'
                    }
                ] : []
            };

            const info = await transporter.sendMail(mailOptions);
            return { success: true, messageId: info.messageId };
        } catch (error) {
            console.error('Error sending email:', error);
            return { success: false, error: error.message };
        }
    }

    // Generate follow-up email
    async generateFollowUpEmail(originalEmail, companyName, jobTitle, senderInfo, followUpNumber) {
        try {
            if (!genAI) {
                throw new Error('Google Generative AI not initialized');
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

            const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
            const result = await model.generateContent(prompt);
            const response = await result.response;
            return response.text();
        } catch (error) {
            console.error('Error generating follow-up email:', error);
            return 'Error generating follow-up email.';
        }
    }
}

export const emailService = new EmailService();