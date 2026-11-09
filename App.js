import React from 'react';
import { View, ActivityIndicator, StyleSheet } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { AuthProvider, useAuth } from './context/AuthContext';
import { ReportProvider } from './context/ReportContext';

import LoginScreen from './screens/LoginScreen';
import SignUpScreen from './screens/SignUpScreen';
import HomeScreen from './screens/HomeScreen';
import JourneyScreen from './screens/JourneyScreen';
import EmergencyContactsScreen from './screens/EmergencyContactsScreen';
import IncidentReportScreen from './screens/IncidentReportScreen.js';
import ReportDetailsScreen from './screens/ReportDetailsScreen.js';
import VideoEvidenceScreen from './screens/VideoEvidenceScreen.js';
import SettingsScreen from './screens/SettingsScreen';
import JourneyHistoryScreen from './screens/JourneyHistoryScreen';
import VehicleScanScreen from './screens/VehicleScanScreen';
import NotificationsScreen from './screens/NotificationsScreen';

const Stack = createNativeStackNavigator();

function AppNavigator() {
  const { isAuthenticated, loading } = useAuth();

  if (loading) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator size="large" color="#8b3fa0" />
      </View>
    );
  }

  return (
    <Stack.Navigator
      screenOptions={{
        headerShown: false,
        animation: 'fade',
      }}
    >
      {isAuthenticated ? (
        <>
          <Stack.Screen name="Home" component={HomeScreen} />
          <Stack.Screen name="Journey" component={JourneyScreen} />
          <Stack.Screen name="EmergencyContacts" component={EmergencyContactsScreen} />
          <Stack.Screen name="IncidentReport" component={IncidentReportScreen} />
          <Stack.Screen name="ReportDetails" component={ReportDetailsScreen} />
          <Stack.Screen name="VideoEvidence" component={VideoEvidenceScreen} />
          <Stack.Screen name="Settings" component={SettingsScreen} />
          <Stack.Screen name="JourneyHistory" component={JourneyHistoryScreen} />
          <Stack.Screen name="VehicleScan" component={VehicleScanScreen} />
          <Stack.Screen name="Notifications" component={NotificationsScreen} />
        </>
      ) : (
        <>
          <Stack.Screen name="Login" component={LoginScreen} />
          <Stack.Screen name="SignUp" component={SignUpScreen} />
        </>
      )}
    </Stack.Navigator>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <ReportProvider>
        <NavigationContainer>
          <AppNavigator />
        </NavigationContainer>
      </ReportProvider>
    </AuthProvider>
  );
}

const styles = StyleSheet.create({
  loading: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#1a0533',
  },
});
