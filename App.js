import React, { Suspense } from 'react';
import { View, ActivityIndicator, StyleSheet } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { AuthProvider, useAuth } from './context/AuthContext';
import { ReportProvider } from './context/ReportContext';
import ErrorBoundary from './context/ErrorBoundary';

const LoginScreen = React.lazy(() => import('./screens/LoginScreen'));
const SignUpScreen = React.lazy(() => import('./screens/SignUpScreen'));
const HomeScreen = React.lazy(() => import('./screens/HomeScreen'));
const JourneyScreen = React.lazy(() => import('./screens/JourneyScreen'));
const EmergencyContactsScreen = React.lazy(() => import('./screens/EmergencyContactsScreen'));
const IncidentReportScreen = React.lazy(() => import('./screens/IncidentReportScreen'));
const ReportDetailsScreen = React.lazy(() => import('./screens/ReportDetailsScreen'));
const VideoEvidenceScreen = React.lazy(() => import('./screens/VideoEvidenceScreen'));
const SettingsScreen = React.lazy(() => import('./screens/SettingsScreen'));
const JourneyHistoryScreen = React.lazy(() => import('./screens/JourneyHistoryScreen'));
const VehicleScanScreen = React.lazy(() => import('./screens/VehicleScanScreen'));
const NotificationsScreen = React.lazy(() => import('./screens/NotificationsScreen'));

const Stack = createNativeStackNavigator();

function ScreenLoader() {
  return (
    <View style={styles.loading}>
      <ActivityIndicator size="large" color="#8b3fa0" />
    </View>
  );
}

function AppNavigator() {
  const { isAuthenticated, loading } = useAuth();

  if (loading) {
    return <ScreenLoader />;
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
          <Stack.Screen name="Home">
            {() => (
              <Suspense fallback={<ScreenLoader />}>
                <HomeScreen />
              </Suspense>
            )}
          </Stack.Screen>
          <Stack.Screen name="Journey">
            {() => (
              <Suspense fallback={<ScreenLoader />}>
                <JourneyScreen />
              </Suspense>
            )}
          </Stack.Screen>
          <Stack.Screen name="EmergencyContacts">
            {() => (
              <Suspense fallback={<ScreenLoader />}>
                <EmergencyContactsScreen />
              </Suspense>
            )}
          </Stack.Screen>
          <Stack.Screen name="IncidentReport">
            {() => (
              <Suspense fallback={<ScreenLoader />}>
                <IncidentReportScreen />
              </Suspense>
            )}
          </Stack.Screen>
          <Stack.Screen name="ReportDetails">
            {() => (
              <Suspense fallback={<ScreenLoader />}>
                <ReportDetailsScreen />
              </Suspense>
            )}
          </Stack.Screen>
          <Stack.Screen name="VideoEvidence">
            {() => (
              <Suspense fallback={<ScreenLoader />}>
                <VideoEvidenceScreen />
              </Suspense>
            )}
          </Stack.Screen>
          <Stack.Screen name="Settings">
            {() => (
              <Suspense fallback={<ScreenLoader />}>
                <SettingsScreen />
              </Suspense>
            )}
          </Stack.Screen>
          <Stack.Screen name="JourneyHistory">
            {() => (
              <Suspense fallback={<ScreenLoader />}>
                <JourneyHistoryScreen />
              </Suspense>
            )}
          </Stack.Screen>
          <Stack.Screen name="VehicleScan">
            {() => (
              <Suspense fallback={<ScreenLoader />}>
                <VehicleScanScreen />
              </Suspense>
            )}
          </Stack.Screen>
          <Stack.Screen name="Notifications">
            {() => (
              <Suspense fallback={<ScreenLoader />}>
                <NotificationsScreen />
              </Suspense>
            )}
          </Stack.Screen>
        </>
      ) : (
        <>
          <Stack.Screen name="Login">
            {() => (
              <Suspense fallback={<ScreenLoader />}>
                <LoginScreen />
              </Suspense>
            )}
          </Stack.Screen>
          <Stack.Screen name="SignUp">
            {() => (
              <Suspense fallback={<ScreenLoader />}>
                <SignUpScreen />
              </Suspense>
            )}
          </Stack.Screen>
        </>
      )}
    </Stack.Navigator>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <ReportProvider>
        <ErrorBoundary>
          <NavigationContainer>
            <AppNavigator />
          </NavigationContainer>
        </ErrorBoundary>
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
