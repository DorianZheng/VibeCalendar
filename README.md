# VibeCalendar - AI-Powered Calendar Scheduling

A modern web application that connects to Google Calendar and uses AI to help users schedule events intelligently. Built with React, Node.js, and Google's Gemini AI.

## 🚀 Features

### Core Features
- **Google Calendar Integration** - Seamlessly connect and sync with your Google Calendar
- **AI-Powered Scheduling** - Use natural language to describe events and let AI find optimal times
- **Smart Conflict Detection** - Automatically avoid scheduling conflicts
- **Beautiful Calendar View** - Modern, responsive calendar interface
- **Event Management** - Create, edit, and manage events with ease

### AI Features
- **Natural Language Processing** - Describe events in plain English
- **Intelligent Time Selection** - AI analyzes your schedule and suggests optimal times
- **Smart Reasoning** - Get explanations for why specific times were chosen
- **Preference Learning** - AI considers your scheduling preferences and constraints

### User Experience
- **Modern UI/UX** - Clean, intuitive interface built with Tailwind CSS
- **Responsive Design** - Works perfectly on desktop, tablet, and mobile
- **Real-time Updates** - Instant synchronization with Google Calendar
- **Toast Notifications** - Clear feedback for all actions

## 🛠️ Tech Stack

### Frontend
- **React 18** - Modern React with hooks and context
- **Tailwind CSS** - Utility-first CSS framework
- **Lucide React** - Beautiful icons
- **React Router** - Client-side routing
- **Axios** - HTTP client
- **React Hot Toast** - Toast notifications
- **Date-fns** - Date manipulation utilities

### Backend
- **Node.js** - JavaScript runtime
- **Express.js** - Web framework
- **Google APIs** - Calendar integration
- **Google Gemini API** - AI-powered scheduling
- **Helmet** - Security middleware
- **CORS** - Cross-origin resource sharing
- **Rate Limiting** - API protection

## 📋 Prerequisites

Before you begin, ensure you have the following installed:
- **Node.js** (v16 or higher)
- **npm** or **yarn**
- **Google Cloud Console** account
- **Google Gemini API** key

## 🔧 Setup Instructions

### 1. Clone the Repository
```bash
git clone <repository-url>
cd VibeCalendar
```

### 2. Install Dependencies
```bash
# Install root dependencies
npm install

# Install server dependencies
cd server
npm install

# Install client dependencies
cd ../client
npm install

# Return to root
cd ..
```

### 3. Environment Configuration

#### Backend Environment Variables
Create a `.env` file in the `server` directory:

```bash
cd server
cp env.example .env
```

Edit the `.env` file with your configuration:

```env
# Server Configuration
PORT=5000
NODE_ENV=development

# Google Calendar API Configuration
GOOGLE_CLIENT_ID=your_google_client_id_here
GOOGLE_CLIENT_SECRET=your_google_client_secret_here
GOOGLE_REDIRECT_URI=http://localhost:5000/api/auth/google/callback

# Google Gemini API Configuration
GEMINI_API_KEY=your_gemini_api_key_here

# Client URL (for CORS)
CLIENT_URL=http://localhost:3000
```

### 4. Google Calendar API Setup

1. **Go to Google Cloud Console**
   - Visit [Google Cloud Console](https://console.cloud.google.com/)
   - Create a new project or select an existing one

2. **Enable Google Calendar API**
   - Go to "APIs & Services" > "Library"
   - Search for "Google Calendar API"
   - Click "Enable"

3. **Create OAuth 2.0 Credentials**
   - Go to "APIs & Services" > "Credentials"
   - Click "Create Credentials" > "OAuth 2.0 Client IDs"
   - Choose "Web application"
   - Add authorized redirect URIs:
     - `http://localhost:5000/api/auth/google/callback`
   - Copy the Client ID and Client Secret to your `.env` file

### 5. Google Gemini API Setup

1. **Get Google Gemini API Key**
   - Visit [Google AI Studio](https://makersuite.google.com/app/apikey)
   - Sign in with your Google account
   - Click "Create API Key"
   - Copy the API key to your `.env` file

### 6. Start the Application

#### Development Mode
```bash
# Start both server and client concurrently
npm run dev
```

#### Production Mode
```bash
# Build the client
npm run build

# Start the server
npm start
```

The application will be available at:
- **Frontend**: http://localhost:3000
- **Backend**: http://localhost:5000

## 🎯 Usage Guide

### 1. Connect Google Calendar
- Click "Connect Google Calendar" in the header
- Authorize the application to access your calendar
- You'll be redirected back to the app

### 2. Use AI Scheduler
- Navigate to "AI Scheduler" from the sidebar
- Describe your event in natural language
- Add preferences and constraints
- Click "Get AI Suggestion"
- Review the AI's suggestion and reasoning
- Click "Create Event" to add it to your calendar

### 3. Manual Event Creation
- Go to "New Event" from the sidebar
- Fill out the event details
- Set date, time, location, and attendees
- Configure reminders
- Click "Create Event"

### 4. View Calendar
- Navigate to "Calendar" to see your events
- Click on any day to view events for that day
- Use the navigation arrows to move between months

## 📁 Project Structure

```
VibeCalendar/
├── client/                 # React frontend
│   ├── public/            # Static files
│   ├── src/
│   │   ├── components/    # React components
│   │   ├── context/       # React context
│   │   ├── App.js         # Main app component
│   │   └── index.js       # Entry point
│   ├── package.json
│   └── tailwind.config.js
├── server/                # Node.js backend
│   ├── index.js          # Main server file
│   ├── package.json
│   └── env.example       # Environment variables template
├── package.json          # Root package.json
└── README.md
```

## 🔒 Security Features

- **Helmet.js** - Security headers
- **Rate Limiting** - API protection
- **CORS Configuration** - Cross-origin security
- **Environment Variables** - Secure configuration management
- **Input Validation** - Form validation and sanitization

## 🚀 Deployment

### Frontend Deployment (Vercel/Netlify)
1. Build the client: `npm run build`
2. Deploy the `client/build` folder to your hosting platform

### Backend Deployment (Heroku/Railway)
1. Set environment variables in your hosting platform
2. Deploy the `server` folder
3. Update the `CLIENT_URL` in your environment variables

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch: `git checkout -b feature-name`
3. Commit your changes: `git commit -am 'Add feature'`
4. Push to the branch: `git push origin feature-name`
5. Submit a pull request

## 📝 License

This project is licensed under the MIT License - see the LICENSE file for details.

## 🆘 Support

If you encounter any issues:

1. Check the console for error messages
2. Verify your environment variables are set correctly
3. Ensure Google Calendar API and Google Gemini API are properly configured
4. Check that all dependencies are installed

## 🔮 Future Enhancements

- [ ] Team scheduling and availability
- [ ] Recurring events with AI optimization
- [ ] Calendar analytics and insights
- [ ] Mobile app (React Native)
- [ ] Integration with other calendar providers
- [ ] Advanced AI features (meeting optimization, travel time calculation)
- [ ] Real-time collaboration features

---

**Built with ❤️ using modern web technologies** 