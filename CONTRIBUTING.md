# Contributing to Abhaya

First off, thank you for considering contributing to Abhaya! It's people like you that make it a great tool. 

## Getting Started

### 1. Fork and Clone the Repository

1. **Fork** the repository on GitHub by clicking the "Fork" button in the top right corner.
2. **Clone** your forked repository to your local machine:
   ```bash
   git clone https://github.com/YOUR-USERNAME/Abhaya.git
   cd Abhaya
   ```

### 2. Setup the Project

The project consists of a React Native (Expo) frontend at the root of the repository, and a Node.js + Express backend in the `backend` directory.

#### Frontend Setup (Expo + React Native)

The frontend code is located at the root of the repository.

1. Install dependencies from the root directory:
   ```bash
   npm install
   ```
2. Start the Expo development server:
   ```bash
   npx expo start
   ```

#### Backend Setup (Node.js + Express)

1. Navigate to the backend directory:
   ```bash
   cd backend
   ```
2. Install dependencies:
   ```bash
   npm install
   ```
3. Start the backend development server:
   ```bash
   npm run dev
   ```

#### Environment Variables Setup

Both frontend and backend might require environment variables. 
1. Look for a `.env.example` file in the root directory (and `backend` directory if one exists).
2. Create a copy of the `.env.example` file and name it `.env`:
   ```bash
   cp .env.example .env
   ```
3. Update the `.env` file with the necessary configuration values for your local environment (e.g., API keys, database URLs).

## Development Workflow

### Branch Naming Conventions

Please follow these conventions when creating a new branch:

- `feature/your-feature-name` (For new features)
- `bugfix/issue-description` (For bug fixes)
- `docs/what-you-documented` (For documentation updates)
- `refactor/what-you-refactored` (For code refactoring)

Example:
```bash
git checkout -b feature/add-user-login
```

### Commit Message Guidelines

We use clear and descriptive commit messages. A good commit message should describe what changed and why.

- **feat**: A new feature
- **fix**: A bug fix
- **docs**: Documentation only changes
- **style**: Changes that do not affect the meaning of the code (white-space, formatting, missing semi-colons, etc)
- **refactor**: A code change that neither fixes a bug nor adds a feature
- **test**: Adding missing tests or correcting existing tests
- **chore**: Changes to the build process or auxiliary tools and libraries such as documentation generation

Example:
```
feat: add user login screen
```

### Code Style Standards

- Follow standard JavaScript/React Native practices.
- Run any linting scripts before committing, if available.
- Write clean, self-documenting code and add comments where necessary.
- Ensure consistent formatting across the codebase.

## Submitting a Pull Request

1. **Ensure all tests pass** (if applicable) and your code builds successfully.
2. **Push your changes** to your fork:
   ```bash
   git push origin your-branch-name
   ```
3. **Open a Pull Request** from your fork to the main repository.
4. **Describe your changes** clearly in the PR description, referencing any related issues.
5. Wait for a review! We will review your changes and might suggest some improvements.

Thank you for contributing!
