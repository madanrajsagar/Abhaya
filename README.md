# 🛡️ Abhaya – Women Safety App

Abhaya is a cross-platform **Women Safety Mobile Application** built using **React Native (Expo)** and **Node.js**.

The application is designed to provide quick emergency assistance through **SOS alerts**, **real-time location support**, **incident reporting**, and **secure evidence storage**.

Its primary goal is to help users respond effectively during emergency situations by enabling them to notify emergency contacts, capture evidence, and generate incident reports.

---

## 📑 Table of Contents

- Features
- Tech Stack
- Project Structure
- Getting Started
- Installation
- Environment Variables
- Deployment
- Contributing
- Future Enhancements
- License

---

# ✨ Features

## 🔐 User Authentication

- User Signup
- User Login
- Profile Management
- Token-based Authentication

## 🚨 SOS Emergency System

- One-tap SOS trigger
- Emergency workflow activation
- Alert generation
- Emergency contact notification

## 📹 Evidence Recording

- Camera and microphone access
- Video evidence recording
- Evidence upload support
- In-app evidence viewing

## 📄 Incident Reporting

- Automatic incident report generation
- Report details screen
- Evidence URL attachment
- Report storage and retrieval

## 📍 Location & Maps

- Real-time location access
- Expo Location integration
- Map support
- Location-based emergency workflow

## ☁️ Cloud Storage

- Cloudinary integration
- Firebase integration
- Secure evidence storage

## 📧 Alert System

- Email notifications using Nodemailer
- Backend emergency alert APIs
- Twilio integration support

---

# 🛠️ Tech Stack

## Frontend

- React Native
- Expo
- JavaScript
- React Navigation
- Expo Camera
- Expo Location
- Expo Video
- Expo AV
- React Native Maps
- AsyncStorage
- Firebase Client SDK
- Expo Linear Gradient

## Backend

- Node.js
- Express.js
- Firebase Admin SDK
- Nodemailer
- Multer
- Twilio
- CORS
- Dotenv
- Nodemon

## Cloud & Services

- Firebase
- Cloudinary
- Gmail SMTP
- Render
- Expo EAS Build
- GitHub

---

# 📁 Project Structure

```text
Abhaya/
│
├── assets/                  # Images and static assets
├── backend/                 # Node.js + Express backend
├── context/                 # React Context
├── ffdemo/                  # Demo resources
├── screens/                 # Application screens
├── services/                # API and helper services
│
├── App.js
├── app.json
├── eas.json
├── index.js
├── package.json
├── package-lock.json
├── .env.example
├── .gitignore
└── README.md
```

---

# 🚀 Getting Started

## Prerequisites

Before running the project, make sure you have:

- Node.js (v18 or later recommended)
- npm
- Expo CLI
- Expo Go (Android/iOS)

---

# 📥 Installation

## 1. Clone the Repository

```bash
git clone https://github.com/madanrajsagar/Abhaya.git
cd Abhaya
```

---

## 2. Install Frontend Dependencies

```bash
npm install
```

---

## 3. Configure Environment Variables

Copy the example environment file.

```bash
cp .env.example .env
```

Update the environment variables with your own configuration.

---

## 4. Start the Frontend

```bash
npx expo start
```

---

## 5. Backend Setup

Move to the backend directory.

```bash
cd backend
```

Install backend dependencies.

```bash
npm install
```

Configure backend environment variables.

```bash
cp .env.example .env
```

Start the backend server.

```bash
npm run dev
```

> **Note:** If the backend does not include a `dev` script, use the script available in `backend/package.json`.

---

# 🔑 Environment Variables

Configure the following values inside your `.env` files.

| Variable | Description |
|----------|-------------|
| Firebase Configuration | Firebase project credentials |
| Cloudinary Credentials | Cloudinary configuration |
| Backend API URL | Backend server endpoint |
| SMTP Credentials | Email notification service |
| Twilio Credentials | SMS alert service (if enabled) |

---

# 🚀 Deployment

### Frontend

- Expo Application Services (EAS)

### Backend

- Render

---

# 🤝 Contributing

Contributions are welcome!

1. Fork the repository.
2. Create a feature branch.

```bash
git checkout -b feature/your-feature-name
```

3. Commit your changes.

```bash
git commit -m "docs: improve README documentation"
```

4. Push the branch.

```bash
git push origin feature/your-feature-name
```

5. Open a Pull Request.

Please ensure your changes follow the project's coding style and documentation standards.

---

# 🚀 Future Enhancements

- Push Notifications
- Live Location Sharing
- Offline SOS Support
- AI-based Threat Detection
- Wearable Device Integration
- Enhanced Emergency Analytics

---

# 📄 License

This project is distributed under the license specified in the repository.

---

# ❤️ Acknowledgements

Abhaya aims to leverage modern mobile technologies to provide a reliable and accessible emergency response solution for women's safety.

Every contribution helps improve the project and makes it more useful for the community.