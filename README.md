# 🤖 AI Email Automation Tool

An intelligent email automation system that researches companies and generates personalized job application emails using Google Gemini AI. Features automated follow-ups and comprehensive campaign management.

## ✨ Features

- **AI-Powered Email Generation**: Uses Google Gemini AI to create personalized, compelling emails
- **Company Research**: Automatically researches target companies using web scraping
- **Resume Analysis**: Extracts and analyzes resume content to highlight relevant skills
- **Automated Follow-ups**: Sends intelligent follow-up emails based on configurable schedules
- **Campaign Management**: Track all email campaigns with detailed analytics
- **Multiple Email Types**: Support for both referral requests and cold emails
- **Professional Dashboard**: Real-time campaign status and management interface

## 🛠️ Technology Stack

- **Frontend**: HTML5, CSS3, JavaScript (Vanilla)
- **Backend**: Node.js, Express.js
- **AI**: Google Gemini API
- **Web Scraping**: Puppeteer, Cheerio
- **Email**: Nodemailer (Gmail SMTP)
- **PDF Processing**: pdf-parse
- **Task Scheduling**: node-cron
- **File Upload**: Multer

## 🚀 Quick Start

### Prerequisites

- Node.js 18.0.0 or higher
- Gmail account with App Password enabled
- Google Gemini API key
- Git (for cloning the repository)

### Installation

1. **Clone the repository**
   ```bash
   git clone https://github.com/yourusername/ai-email-automation.git
   cd ai-email-automation
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Set up environment variables**
   ```bash
   cp .env.example .env
   ```
   Edit the `.env` file with your configuration (see Configuration section below)

4. **Create required directories**
   ```bash
   mkdir uploads
   mkdir public
   mkdir logs
   ```

5. **Move the HTML file**
   Save the HTML frontend code as `public/index.html`

6. **Start the server**
   ```bash
   npm start
   ```
   Or for development with auto-reload:
   ```bash
   npm run dev
   ```

7. **Access the application**
   Open your browser and navigate to `http://localhost:3000`

## ⚙️ Configuration

### Required Environment Variables

#### Google Gemini API
1. Visit [Google AI Studio](https://makersuite.google.com/app/apikey)
2. Create a new API key
3. Add to `.env`: `GEMINI_API_KEY=your_api_key_here`

#### Gmail Configuration
1. Enable 2-Factor Authentication on your Gmail account
2. Generate an App Password:
   - Go to Google Account Settings
   - Security → 2-Step Verification
   - App passwords → Generate password
3. Add to `.env`:
   ```
   EMAIL_USER=your-email@gmail.com
   EMAIL_PASS=your-16-character-app-password
   ```

#### Optional: Google Custom Search (Enhanced Company Research)
1. Create a Custom Search Engine at [Google CSE](https://cse.google.com/)
2. Get API key from [Google Cloud Console](https://console.cloud.google.com/)
3. Add to `.env`:
   ```
   GOOGLE_SEARCH_API_KEY=your_search_api_key
   GOOGLE_SEARCH_ENGINE_ID=your_search_engine_id
   ```

## 📱 Usage

### Creating a Campaign

1. **Fill out the form**:
   - Recipient email (HR or employee)
   - Company name and website
   - Target job title
   - Choose email type (referral or cold email)
   - Upload your resume (PDF format)
   - Add any additional information

2. **Submit**: The AI will:
   - Research the company
   - Analyze your resume
   - Generate a personalized email
   - Send it automatically

3. **Track Progress**: Monitor your campaigns in the dashboard

### Automated Follow-ups

The system automatically sends follow-up emails:
- **First follow-up**: 3 days after initial email
- **Second follow-up**: 1 week after first follow-up
- **Maximum**: 2 follow-ups per campaign

## 🔧 Advanced Configuration

### Email Template Customization

Modify the AI prompts in `server.js` to customize email generation:

```javascript
// Around line 200 in server.js
const prompt = `
Your custom prompt here...
`;
```

### Follow-up Schedule

Adjust follow-up timing in the cron job section:

```javascript
// Change the schedule (currently 9 AM daily)
cron.schedule('0 9 * * *', async () => {
    // Follow-up logic
});
```

### Rate Limiting

Configure email limits in `.env`:
```
MAX_EMAILS_PER_HOUR=50
MAX_CAMPAIGNS_PER_USER=100
```

## 📊 API Endpoints

### Campaign Management
- `POST /api/send-email` - Create and send new campaign
- `GET /api/campaigns` - Get all campaigns
- `GET /api/campaigns/:id` - Get specific campaign
- `POST /api/campaigns/:id/follow-up` - Manual follow-up

### Example API Usage

```javascript
// Create new campaign
const formData = new FormData();
formData.append('recipientEmail', 'hr@company.com');
formData.append('companyName', 'Tech Corp');
formData.append('jobTitle', 'Software Engineer');
formData.append('emailType', 'coldMail');
formData.append('resume', fileInput.files[0]);

fetch('/api/send-email', {
    method: 'POST',
    body: formData
});
```

## 🔒 Security Considerations

### Production Deployment

1. **Environment Variables**: Never commit `.env` files
2. **HTTPS**: Use SSL certificates in production
3. **Authentication**: Implement user authentication for multi-user setups
4. **Rate Limiting**: Configure appropriate limits
5. **Input Validation**: Sanitize all user inputs
6. **File Upload Security**: Restrict file types and sizes

### Recommended Security Headers

```javascript
// Add to server.js
app.use(helmet({
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            styleSrc: ["'self'", "'unsafe-inline'"],
            scriptSrc: ["'self'"]
        }
    }
}));
```

## 🚀 Deployment

### Heroku Deployment

1. **Install Heroku CLI**
2. **Create Heroku app**
   ```bash
   heroku create your-app-name
   ```

3. **Set environment variables**
   ```bash
   heroku config:set GEMINI_API_KEY=your_key
   heroku config:set EMAIL_USER=your_email
   heroku config:set EMAIL_PASS=your_password
   ```

4. **Deploy**
   ```bash
   git push heroku main
   ```

### DigitalOcean/AWS Deployment

1. **Set up server** (Ubuntu 20.04+)
2. **Install Node.js and PM2**
   ```bash
   curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
   sudo apt-get install -y nodejs
   sudo npm install -g pm2
   ```

3. **Clone and setup**
   ```bash
   git clone your-repo
   cd ai-email-automation
   npm install
   cp .env.example .env
   # Edit .env with your configuration
   ```

4. **Start with PM2**
   ```bash
   pm2 start server.js --name "email-automation"
   pm2 startup
   pm2 save
   ```

5. **Set up Nginx reverse proxy**
   ```nginx
   server {
       listen 80;
       server_name your-domain.com;
       
       location / {
           proxy_pass http://localhost:3000;
           proxy_set_header Host $host;
           proxy_set_header X-Real-IP $remote_addr;
       }
   }
   ```

## 🐛 Troubleshooting

### Common Issues

1. **Gmail Authentication Error**
   - Ensure 2FA is enabled
   - Use App Password, not regular password
   - Check Gmail security settings

2. **Gemini API Error**
   - Verify API key is correct
   - Check API quotas and billing
   - Ensure proper request formatting

3. **PDF Processing Error**
   - Verify PDF is not corrupted
   - Check file size limits
   - Ensure proper file upload

4. **Company Research Failing**
   - Website might be blocking scraping
   - Check internet connectivity
   - Verify Google Search API setup

### Debug Mode

Enable detailed logging:
```bash
NODE_ENV=development npm start
```

## 📈 Performance Optimization

### Caching
- Implement Redis for caching company research
- Cache AI responses for similar queries

### Database
- Replace in-memory storage with PostgreSQL/MongoDB
- Add database indexing for faster queries

### Scaling
- Use worker processes for background tasks
- Implement queue system (Bull.js, Agenda)
- Add load balancing for multiple instances

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests
5. Submit a pull request

## 📄 License

This project is licensed under the MIT License - see the LICENSE file for details.

## 🆘 Support

For issues and questions:
- Create an issue on GitHub
- Check existing documentation
- Review troubleshooting section

## 🔮 Future Enhancements

- [ ] Multi-language support
- [ ] Advanced analytics dashboard
- [ ] Integration with job boards
- [ ] Email template library
- [ ] A/B testing for email effectiveness
- [ ] CRM integration
- [ ] Mobile app
- [ ] Voice-to-text resume input
- [ ] LinkedIn integration
- [ ] Advanced sentiment analysis

---

**Happy Job Hunting! 🎯**