# Google Gemini API Setup Guide

This guide will help you set up Google Gemini API for your VibeCalendar application.

## 🚀 Quick Setup

### 1. Get Your Gemini API Key

1. **Visit Google AI Studio**
   - Go to [Google AI Studio](https://makersuite.google.com/app/apikey)
   - Sign in with your Google account

2. **Create API Key**
   - Click "Create API Key" button
   - Choose "Create API Key in new project" or select an existing project
   - Copy the generated API key

3. **Configure Environment**
   - Open `server/.env` file
   - Add your API key:
   ```env
   GEMINI_API_KEY=your_gemini_api_key_here
   ```

### 2. Test the Integration

Run the test script to verify everything is working:

```bash
cd server
npm run test-gemini
```

You should see output like:
```
🤖 Testing Google Gemini API...
✅ Gemini API Response:
{
  "suggestedTime": "2024-01-15T10:00:00",
  "duration": "01:00",
  "title": "Q4 Strategy Team Meeting",
  "description": "Team meeting to discuss Q4 strategy and planning",
  "location": "Conference Room A",
  "attendees": ["team@company.com"],
  "reminders": ["15 minutes before", "1 hour before"],
  "reasoning": "Suggested Tuesday morning to avoid Monday blues and ensure team is fresh for strategic discussion"
}
✅ Successfully parsed JSON response
```

## 🔧 Detailed Setup

### Prerequisites

- Google account
- Node.js installed
- VibeCalendar project set up

### Step-by-Step Instructions

#### 1. Access Google AI Studio

1. Visit [Google AI Studio](https://makersuite.google.com/app/apikey)
2. Sign in with your Google account
3. Accept the terms of service if prompted

#### 2. Create API Key

1. **Click "Create API Key"**
   - You'll see options to create in a new project or existing project
   - For new users, select "Create API Key in new project"

2. **Project Setup** (if creating new project)
   - Enter a project name (e.g., "VibeCalendar")
   - Click "Create"

3. **Copy the API Key**
   - The API key will be displayed
   - Copy it immediately (you won't be able to see it again)
   - Store it securely

#### 3. Configure Your Application

1. **Create Environment File**
   ```bash
   cd server
   cp env.example .env
   ```

2. **Add Your API Key**
   ```env
   # Google Gemini API Configuration
   GEMINI_API_KEY=your_actual_api_key_here
   ```

3. **Verify Configuration**
   ```bash
   npm run test-gemini
   ```

### 4. Start Your Application

```bash
# From the root directory
npm run dev
```

## 🔍 Troubleshooting

### Common Issues

#### 1. "GEMINI_API_KEY not found"
- **Solution**: Make sure you've created the `.env` file in the `server` directory
- **Check**: Verify the API key is correctly copied without extra spaces

#### 2. "API key not valid"
- **Solution**: Regenerate your API key in Google AI Studio
- **Check**: Ensure you're using the correct API key

#### 3. "Rate limit exceeded"
- **Solution**: Wait a few minutes and try again
- **Note**: Free tier has generous limits for development

#### 4. "Failed to parse JSON response"
- **Solution**: This is normal - Gemini sometimes returns formatted text
- **Note**: The application handles this gracefully with fallback responses

### API Limits

- **Free Tier**: 15 requests per minute
- **Paid Tier**: Higher limits available
- **Model**: Uses `gemini-pro` model

## 🎯 Usage Examples

### Natural Language Scheduling

Try these examples in the AI Scheduler:

1. **Simple Meeting**
   ```
   "Team standup meeting"
   ```

2. **Complex Event**
   ```
   "Client presentation for the new product launch, need 2 hours, prefer afternoon, attendees: john@company.com, sarah@company.com"
   ```

3. **With Constraints**
   ```
   "Doctor appointment, prefer morning, avoid Mondays and Fridays, need 1 hour"
   ```

### Expected Responses

Gemini will provide structured responses like:
```json
{
  "suggestedTime": "2024-01-16T09:00:00",
  "duration": "01:00",
  "title": "Team Standup Meeting",
  "description": "Daily team standup to discuss progress and blockers",
  "location": "Conference Room A",
  "attendees": [],
  "reminders": ["15 minutes before"],
  "reasoning": "Suggested Tuesday morning at 9 AM for optimal team availability and productivity"
}
```

## 🔒 Security Best Practices

1. **Never commit API keys to version control**
2. **Use environment variables**
3. **Rotate API keys regularly**
4. **Monitor API usage**
5. **Set up billing alerts if using paid tier**

## 📚 Additional Resources

- [Google AI Studio Documentation](https://ai.google.dev/docs)
- [Gemini API Reference](https://ai.google.dev/api/gemini-api)
- [Google Cloud Console](https://console.cloud.google.com/)

## 🆘 Support

If you encounter issues:

1. Check the console for error messages
2. Verify your API key is correct
3. Test with the provided test script
4. Check Google AI Studio for service status
5. Review the troubleshooting section above

---

**Happy scheduling with Google Gemini AI! 🚀** 