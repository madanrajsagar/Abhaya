import React, { createContext, useContext, useState, useEffect } from 'react';
import authAPI from '../services/api';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  // Check for existing session on app start
  useEffect(() => {
    checkSession();
  }, []);

  const checkSession = async () => {
    try {
      const result = await authAPI.validateSession();
      if (result.valid) {
        setUser(result.user);
      } else {
        setUser(null);
      }
    } catch (error) {
      console.error('Session check failed:', error);
    } finally {
      setLoading(false);
    }
  };

  const login = async (email, password) => {
    const result = await authAPI.login(email, password);
    if (result.success) {
      setUser(result.data);
    }
    return result;
  };

  const signup = async (email, password, displayName, safetyPassword) => {
    const result = await authAPI.signup(email, password, displayName, safetyPassword);
    if (result.success) {
      setUser(result.data);
    }
    return result;
  };

  const logout = async () => {
    await authAPI.logout();
    setUser(null);
  };

  const refreshProfile = async () => {
    const result = await authAPI.getProfile();
    if (result.success) {
      setUser(result.data);
    }
    return result;
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        loading,
        login,
        signup,
        logout,
        refreshProfile,
        isAuthenticated: !!user,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
