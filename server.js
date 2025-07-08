const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const puppeteer = require('puppeteer');
const nodemailer = require('nodemailer');
const cron = require('node-cron');
const pdf = require('pdf-parse');
const axios = require('axios');
const cheerio = require('cheerio');
const { v4: uuidv4 } = require('uuid');

// Load environment variables
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Initialize Google Generative AI
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// Configure multer for file uploads
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, 'uploads/');
    },
    filename: function (req, file, cb) {
        cb(null, Date.now() + '-' + file.originalname);
    }
});

const upload = multer({ storage: storage });

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));

// Create uploads directory if it doesn't exist
if (!fs.existsSync('uploads')) {
    fs.mkdirSync('uploads');
}

// In-memory storage for campaigns (replace with database in production)
let campaigns = [];

// Email transporter configuration
const createEmailTransporter = () => {
    return nodemailer.createTransport({
        service: 'gmail',
        auth: {
            user: process.env.EMAIL_USER,
            pass: process.env.EMAIL_PASS // Use app-specific password
        }
    });
};

// Extract sender information from resume
async function extractSenderInfo(resumeText) {
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
async function researchCompany(companyName, companyWebsite) {
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

// Extract text from PDF resume
async function extractResumeText(filePath) {
    try {
        const dataBuffer = fs.readFileSync(filePath);
        const data = await pdf(dataBuffer);
        return data.text;
    } catch (error) {
        console.error('Error extracting resume text:', error);
        return '';
    }
}

// Generate personalized email using Gemini AI
async function generatePersonalizedEmail(companyInfo, resumeText, senderInfo, emailType, jobTitle, recipientName, additionalInfo) {
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
async function sendEmail(recipientEmail, subject, body, senderInfo, resumePath) {
    try {
        const transporter = createEmailTransporter();
        
        const mailOptions = {
            from: `${senderInfo.fullName} <${process.env.EMAIL_USER}>`,
            to: recipientEmail,
            subject: subject,
            text: body,
            html: body.replace(/\n/g, '<br>'),
            attachments: [
                {
                    filename: `${senderInfo.fullName.replace(/\s+/g, '_')}_Resume.pdf`,
                    path: resumePath,
                    contentType: 'application/pdf'
                }
            ]
        };

        const info = await transporter.sendMail(mailOptions);
        return { success: true, messageId: info.messageId };
    } catch (error) {
        console.error('Error sending email:', error);
        return { success: false, error: error.message };
    }
}

// Generate follow-up email
async function generateFollowUpEmail(originalEmail, companyName, jobTitle, senderInfo, followUpNumber) {
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

        const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
        const result = await model.generateContent(prompt);
        const response = await result.response;
        return response.text();
    } catch (error) {
        console.error('Error generating follow-up email:', error);
        return 'Error generating follow-up email.';
    }
}

// Routes

// Serve the main page
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// API endpoint to send email
app.post('/api/send-email', upload.single('resume'), async (req, res) => {
    try {
        const {
            recipientEmail,
            recipientName,
            companyName,
            companyWebsite,
            jobTitle,
            emailType,
            additionalInfo
        } = req.body;

        if (!req.file) {
            return res.status(400).json({ error: 'Resume file is required' });
        }

        // Generate unique campaign ID
        const campaignId = uuidv4();

        // Create campaign record
        const campaign = {
            id: campaignId,
            recipientEmail,
            recipientName,
            companyName,
            companyWebsite,
            jobTitle,
            emailType,
            additionalInfo,
            resumePath: req.file.path,
            status: 'pending',
            createdAt: new Date(),
            updatedAt: new Date(),
            emailSent: null,
            lastFollowUp: null,
            followUpCount: 0,
            originalEmail: '',
            emailPreview: '',
            senderInfo: null
        };

        campaigns.push(campaign);

        // Background processing
        (async () => {
            try {
                campaign.status = 'processing';
                campaign.updatedAt = new Date();

                // Extract resume text
                const resumeText = await extractResumeText(req.file.path);
                
                // Extract sender information from resume
                const senderInfo = await extractSenderInfo(resumeText);
                campaign.senderInfo = senderInfo;

                campaign.status = 'researching';
                campaign.updatedAt = new Date();

                // Research company
                const companyInfo = await researchCompany(companyName, companyWebsite);

                // Generate personalized email
                const generatedEmail = await generatePersonalizedEmail(
                    companyInfo,
                    resumeText,
                    senderInfo,
                    emailType,
                    jobTitle,
                    recipientName,
                    additionalInfo
                );

                campaign.originalEmail = generatedEmail;
                campaign.emailPreview = generatedEmail.substring(0, 500) + '...';

                // Extract subject and body
                const subjectMatch = generatedEmail.match(/Subject:\s*(.+)/);
                const subject = subjectMatch ? subjectMatch[1].trim() : `Application for ${jobTitle} position`;
                
                const bodyStart = generatedEmail.indexOf('\n\n') + 2;
                const body = generatedEmail.substring(bodyStart).trim();

                // Send email with resume attachment
                const emailResult = await sendEmail(recipientEmail, subject, body, senderInfo, req.file.path);

                if (emailResult.success) {
                    campaign.status = 'sent';
                    campaign.emailSent = new Date();
                } else {
                    campaign.status = 'failed';
                    campaign.error = emailResult.error;
                }

                campaign.updatedAt = new Date();

            } catch (error) {
                console.error('Error in background processing:', error);
                campaign.status = 'failed';
                campaign.error = error.message;
                campaign.updatedAt = new Date();
            }
        })();

        res.json({
            success: true,
            campaignId,
            status: 'pending',
            message: 'Email campaign started. AI is processing your resume and will send the email shortly.',
            emailPreview: 'Processing...'
        });

    } catch (error) {
        console.error('Error in send-email endpoint:', error);
        res.status(500).json({ error: error.message });
    }
});

// API endpoint to get campaigns
app.get('/api/campaigns', (req, res) => {
    const campaignsData = campaigns.map(campaign => ({
        id: campaign.id,
        recipientEmail: campaign.recipientEmail,
        recipientName: campaign.recipientName,
        companyName: campaign.companyName,
        jobTitle: campaign.jobTitle,
        emailType: campaign.emailType,
        status: campaign.status,
        createdAt: campaign.createdAt,
        updatedAt: campaign.updatedAt,
        emailSent: campaign.emailSent,
        lastFollowUp: campaign.lastFollowUp,
        followUpCount: campaign.followUpCount,
        error: campaign.error,
        senderInfo: campaign.senderInfo ? {
            fullName: campaign.senderInfo.fullName,
            email: campaign.senderInfo.email,
            currentTitle: campaign.senderInfo.currentTitle
        } : null
    }));

    res.json(campaignsData);
});

// API endpoint to get campaign details
app.get('/api/campaigns/:id', (req, res) => {
    const campaign = campaigns.find(c => c.id === req.params.id);
    
    if (!campaign) {
        return res.status(404).json({ error: 'Campaign not found' });
    }

    res.json({
        ...campaign,
        resumePath: undefined // Don't expose file path
    });
});

// API endpoint to manually trigger follow-up
app.post('/api/campaigns/:id/follow-up', async (req, res) => {
    try {
        const campaign = campaigns.find(c => c.id === req.params.id);
        
        if (!campaign) {
            return res.status(404).json({ error: 'Campaign not found' });
        }

        if (campaign.status !== 'sent') {
            return res.status(400).json({ error: 'Can only follow up on sent campaigns' });
        }

        if (!campaign.senderInfo) {
            return res.status(400).json({ error: 'Sender information not available' });
        }

        // Generate follow-up email
        const followUpEmail = await generateFollowUpEmail(
            campaign.originalEmail,
            campaign.companyName,
            campaign.jobTitle,
            campaign.senderInfo,
            campaign.followUpCount + 1
        );

        // Extract subject and body
        const subjectMatch = followUpEmail.match(/Subject:\s*(.+)/);
        const subject = subjectMatch ? subjectMatch[1].trim() : `Follow-up: ${campaign.jobTitle} position`;
        
        const bodyStart = followUpEmail.indexOf('\n\n') + 2;
        const body = followUpEmail.substring(bodyStart).trim();

        // Send follow-up email (without attachment for follow-ups)
        const emailResult = await sendEmail(campaign.recipientEmail, subject, body, campaign.senderInfo, null);

        if (emailResult.success) {
            campaign.followUpCount++;
            campaign.lastFollowUp = new Date();
            campaign.updatedAt = new Date();
            
            res.json({
                success: true,
                message: 'Follow-up email sent successfully',
                followUpCount: campaign.followUpCount
            });
        } else {
            res.status(500).json({ error: emailResult.error });
        }

    } catch (error) {
        console.error('Error sending follow-up:', error);
        res.status(500).json({ error: error.message });
    }
});

// Automated follow-up system using cron jobs
// Run every day at 9 AM
cron.schedule('0 9 * * *', async () => {
    console.log('Running automated follow-up check...');
    
    const now = new Date();
    const threeDaysAgo = new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000);
    const oneWeekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    
    for (const campaign of campaigns) {
        if (campaign.status === 'sent' && campaign.followUpCount < 2 && campaign.senderInfo) {
            const emailSentDate = new Date(campaign.emailSent);
            const lastFollowUpDate = campaign.lastFollowUp ? new Date(campaign.lastFollowUp) : null;
            
            let shouldSendFollowUp = false;
            
            // First follow-up after 3 days
            if (campaign.followUpCount === 0 && emailSentDate <= threeDaysAgo) {
                shouldSendFollowUp = true;
            }
            // Second follow-up after 1 week from last follow-up
            else if (campaign.followUpCount === 1 && lastFollowUpDate && lastFollowUpDate <= oneWeekAgo) {
                shouldSendFollowUp = true;
            }
            
            if (shouldSendFollowUp) {
                try {
                    console.log(`Sending automated follow-up for campaign ${campaign.id}`);
                    
                    const followUpEmail = await generateFollowUpEmail(
                        campaign.originalEmail,
                        campaign.companyName,
                        campaign.jobTitle,
                        campaign.senderInfo,
                        campaign.followUpCount + 1
                    );

                    const subjectMatch = followUpEmail.match(/Subject:\s*(.+)/);
                    const subject = subjectMatch ? subjectMatch[1].trim() : `Follow-up: ${campaign.jobTitle} position`;
                    
                    const bodyStart = followUpEmail.indexOf('\n\n') + 2;
                    const body = followUpEmail.substring(bodyStart).trim();

                    const emailResult = await sendEmail(campaign.recipientEmail, subject, body, campaign.senderInfo, null);

                    if (emailResult.success) {
                        campaign.followUpCount++;
                        campaign.lastFollowUp = new Date();
                        campaign.updatedAt = new Date();
                        console.log(`Follow-up sent successfully for campaign ${campaign.id}`);
                    } else {
                        console.error(`Failed to send follow-up for campaign ${campaign.id}:`, emailResult.error);
                    }
                } catch (error) {
                    console.error(`Error sending automated follow-up for campaign ${campaign.id}:`, error);
                }
            }
        }
    }
});

// Cleanup old campaigns (optional)
cron.schedule('0 0 * * 0', () => {
    console.log('Cleaning up old campaigns...');
    const oneMonthAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    
    campaigns = campaigns.filter(campaign => {
        const shouldKeep = new Date(campaign.createdAt) > oneMonthAgo;
        
        if (!shouldKeep) {
            // Delete resume file
            try {
                if (fs.existsSync(campaign.resumePath)) {
                    fs.unlinkSync(campaign.resumePath);
                }
            } catch (error) {
                console.error('Error deleting resume file:', error);
            }
        }
        
        return shouldKeep;
    });
    
    console.log(`Cleanup complete. ${campaigns.length} campaigns remaining.`);
});

// Error handling middleware
app.use((error, req, res, next) => {
    console.error('Global error handler:', error);
    res.status(500).json({ error: 'Internal server error' });
});

// Start server
app.listen(PORT, () => {
    console.log(`🚀 AI Email Automation Server running on port ${PORT}`);
    console.log(`📧 Make sure to set up your environment variables:`);
    console.log(`   - GEMINI_API_KEY: Your Google Gemini API key`);
    console.log(`   - EMAIL_USER: Your Gmail address`);
    console.log(`   - EMAIL_PASS: Your Gmail app-specific password`);
    console.log(`   - GOOGLE_SEARCH_API_KEY: Google Custom Search API key (optional)`);
    console.log(`   - GOOGLE_SEARCH_ENGINE_ID: Google Custom Search Engine ID (optional)`);
    console.log(`\n📁 Make sure the 'public' directory contains your HTML file`);
    console.log(`\n🎯 Ready to automate your job search emails with resume attachments!`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
    console.log('Received SIGTERM. Shutting down gracefully...');
    process.exit(0);
});

process.on('SIGINT', () => {
    console.log('Received SIGINT. Shutting down gracefully...');
    process.exit(0);
});