import React, { useState, useRef, useEffect } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Animated,
  KeyboardAvoidingView,
  Platform,
  Dimensions,
  StatusBar,
  ActivityIndicator,
  ScrollView,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useAuth } from '../context/AuthContext';
import {
  SECURITY_PASSWORD_DESCRIPTION,
  cacheSecurityPassword,
} from '../services/securityPassword';

const { width, height } = Dimensions.get('window');

export default function SignUpScreen({ navigation }) {
  const { signup } = useAuth();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [safetyPassword, setSafetyPassword] = useState('');
  const [confirmSafetyPassword, setConfirmSafetyPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [showSafetyPassword, setShowSafetyPassword] = useState(false);
  const [showConfirmSafetyPassword, setShowConfirmSafetyPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const [nameFocused, setNameFocused] = useState(false);
  const [emailFocused, setEmailFocused] = useState(false);
  const [passwordFocused, setPasswordFocused] = useState(false);
  const [confirmFocused, setConfirmFocused] = useState(false);
  const [safetyPasswordFocused, setSafetyPasswordFocused] = useState(false);
  const [confirmSafetyFocused, setConfirmSafetyFocused] = useState(false);

  const fadeAnim = useRef(new Animated.Value(0)).current;
  const slideAnim = useRef(new Animated.Value(50)).current;
  const logoScale = useRef(new Animated.Value(0.3)).current;
  const cardSlide = useRef(new Animated.Value(100)).current;
  const buttonScale = useRef(new Animated.Value(1)).current;
  const errorAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.sequence([
      Animated.parallel([
        Animated.timing(fadeAnim, {
          toValue: 1,
          duration: 800,
          useNativeDriver: true,
        }),
        Animated.spring(logoScale, {
          toValue: 1,
          friction: 4,
          tension: 40,
          useNativeDriver: true,
        }),
      ]),
      Animated.parallel([
        Animated.timing(cardSlide, {
          toValue: 0,
          duration: 600,
          useNativeDriver: true,
        }),
        Animated.timing(slideAnim, {
          toValue: 0,
          duration: 600,
          useNativeDriver: true,
        }),
      ]),
    ]).start();
  }, []);

  useEffect(() => {
    if (error) {
      Animated.sequence([
        Animated.timing(errorAnim, { toValue: 1, duration: 300, useNativeDriver: true }),
        Animated.delay(3000),
        Animated.timing(errorAnim, { toValue: 0, duration: 300, useNativeDriver: true }),
      ]).start(() => setError(''));
    }
  }, [error]);

  const getPasswordStrength = () => {
    if (!password) return { level: 0, label: '', color: '#ddd' };
    if (password.length < 6) return { level: 1, label: 'Weak', color: '#ff4757' };
    if (password.length < 8) return { level: 2, label: 'Fair', color: '#ffa502' };
    const hasUpper = /[A-Z]/.test(password);
    const hasNumber = /[0-9]/.test(password);
    const hasSpecial = /[!@#$%^&*]/.test(password);
    if (hasUpper && hasNumber && hasSpecial) return { level: 4, label: 'Strong', color: '#2ed573' };
    if ((hasUpper && hasNumber) || (hasUpper && hasSpecial) || (hasNumber && hasSpecial))
      return { level: 3, label: 'Good', color: '#7bed9f' };
    return { level: 2, label: 'Fair', color: '#ffa502' };
  };

  const handleSignUp = async () => {
    if (!name.trim()) {
      setError('Please enter your full name.');
      return;
    }
    if (!email.trim()) {
      setError('Please enter your email address.');
      return;
    }
    if (!password) {
      setError('Please create a password.');
      return;
    }
    if (password.length < 6) {
      setError('Password must be at least 6 characters.');
      return;
    }
    if (password !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }
    if (!safetyPassword.trim()) {
      setError('Please create a safety password.');
      return;
    }
    if (safetyPassword.trim().length < 8) {
      setError('Safety password must be at least 8 characters.');
      return;
    }
    if (safetyPassword.trim() !== confirmSafetyPassword.trim()) {
      setError('Safety passwords do not match.');
      return;
    }

    setLoading(true);
    setError('');

    Animated.sequence([
      Animated.timing(buttonScale, {
        toValue: 0.95,
        duration: 100,
        useNativeDriver: true,
      }),
      Animated.timing(buttonScale, {
        toValue: 1,
        duration: 100,
        useNativeDriver: true,
      }),
    ]).start();

    const result = await signup(email.trim(), password, name.trim(), safetyPassword.trim());

    if (!result.success) {
      setError(result.error || 'Sign up failed. Please try again.');
    } else {
      await cacheSecurityPassword({
        email: email.trim(),
        safetyPassword: safetyPassword.trim(),
      });
    }
    // Navigation is handled by AuthContext in App.js

    setLoading(false);
  };

  const strength = getPasswordStrength();

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" translucent backgroundColor="transparent" />
      <LinearGradient
        colors={['#1a0533', '#2d1b69', '#5b2c8e', '#8b3fa0']}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.gradient}
      >
        <View style={[styles.circle, styles.circle1]} />
        <View style={[styles.circle, styles.circle2]} />
        <View style={[styles.circle, styles.circle3]} />

        <ScrollView
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          <KeyboardAvoidingView
            behavior={Platform.OS === 'ios' ? 'padding' : undefined}
            style={styles.keyboardView}
          >
            <Animated.View
              style={[
                styles.logoContainer,
                { opacity: fadeAnim, transform: [{ scale: logoScale }] },
              ]}
            >
              <View style={styles.shieldIcon}>
                <Ionicons name="shield-checkmark" size={40} color="#fff" />
              </View>
              <Text style={styles.appName}>SafeGuard</Text>
            </Animated.View>

            {error ? (
              <Animated.View style={[styles.errorContainer, { opacity: errorAnim }]}>
                <Ionicons name="alert-circle" size={18} color="#ff4757" />
                <Text style={styles.errorText}>{error}</Text>
              </Animated.View>
            ) : null}

            <Animated.View
              style={[
                styles.card,
                { opacity: fadeAnim, transform: [{ translateY: cardSlide }] },
              ]}
            >
              <Text style={styles.welcomeText}>Create Account</Text>
              <Text style={styles.subtitle}>Join us and stay safe</Text>
              <Text style={styles.securityHint}>{SECURITY_PASSWORD_DESCRIPTION}</Text>

              {/* Name */}
              <View style={[styles.inputContainer, nameFocused && styles.inputContainerFocused]}>
                <Ionicons name="person-outline" size={20} color={nameFocused ? '#8b3fa0' : '#999'} style={styles.inputIcon} />
                <TextInput
                  style={styles.input}
                  placeholder="Full name"
                  placeholderTextColor="#999"
                  value={name}
                  onChangeText={setName}
                  onFocus={() => setNameFocused(true)}
                  onBlur={() => setNameFocused(false)}
                  autoCapitalize="words"
                  editable={!loading}
                />
              </View>

              {/* Email */}
              <View style={[styles.inputContainer, emailFocused && styles.inputContainerFocused]}>
                <Ionicons name="mail-outline" size={20} color={emailFocused ? '#8b3fa0' : '#999'} style={styles.inputIcon} />
                <TextInput
                  style={styles.input}
                  placeholder="Email address"
                  placeholderTextColor="#999"
                  value={email}
                  onChangeText={setEmail}
                  onFocus={() => setEmailFocused(true)}
                  onBlur={() => setEmailFocused(false)}
                  keyboardType="email-address"
                  autoCapitalize="none"
                  editable={!loading}
                />
              </View>

              {/* Password */}
              <View style={[styles.inputContainer, passwordFocused && styles.inputContainerFocused]}>
                <Ionicons name="lock-closed-outline" size={20} color={passwordFocused ? '#8b3fa0' : '#999'} style={styles.inputIcon} />
                <TextInput
                  style={styles.input}
                  placeholder="Password"
                  placeholderTextColor="#999"
                  value={password}
                  onChangeText={setPassword}
                  onFocus={() => setPasswordFocused(true)}
                  onBlur={() => setPasswordFocused(false)}
                  secureTextEntry={!showPassword}
                  editable={!loading}
                />
                <TouchableOpacity onPress={() => setShowPassword(!showPassword)} style={styles.eyeIcon}>
                  <Ionicons name={showPassword ? 'eye-outline' : 'eye-off-outline'} size={20} color="#999" />
                </TouchableOpacity>
              </View>

              {/* Password Strength */}
              {password ? (
                <View style={styles.strengthContainer}>
                  <View style={styles.strengthBars}>
                    {[1, 2, 3, 4].map((level) => (
                      <View
                        key={level}
                        style={[
                          styles.strengthBar,
                          { backgroundColor: level <= strength.level ? strength.color : '#e0e0e0' },
                        ]}
                      />
                    ))}
                  </View>
                  <Text style={[styles.strengthLabel, { color: strength.color }]}>{strength.label}</Text>
                </View>
              ) : null}

              {/* Confirm Password */}
              <View style={[styles.inputContainer, confirmFocused && styles.inputContainerFocused]}>
                <Ionicons name="lock-open-outline" size={20} color={confirmFocused ? '#8b3fa0' : '#999'} style={styles.inputIcon} />
                <TextInput
                  style={styles.input}
                  placeholder="Confirm password"
                  placeholderTextColor="#999"
                  value={confirmPassword}
                  onChangeText={setConfirmPassword}
                  onFocus={() => setConfirmFocused(true)}
                  onBlur={() => setConfirmFocused(false)}
                  secureTextEntry={!showConfirmPassword}
                  editable={!loading}
                />
                <TouchableOpacity onPress={() => setShowConfirmPassword(!showConfirmPassword)} style={styles.eyeIcon}>
                  <Ionicons name={showConfirmPassword ? 'eye-outline' : 'eye-off-outline'} size={20} color="#999" />
                </TouchableOpacity>
              </View>

              {confirmPassword ? (
                <View style={styles.matchContainer}>
                  <Ionicons
                    name={password === confirmPassword ? 'checkmark-circle' : 'close-circle'}
                    size={16}
                    color={password === confirmPassword ? '#2ed573' : '#ff4757'}
                  />
                  <Text style={[styles.matchText, { color: password === confirmPassword ? '#2ed573' : '#ff4757' }]}>
                    {password === confirmPassword ? 'Passwords match' : 'Passwords do not match'}
                  </Text>
                </View>
              ) : null}

              <View style={[styles.inputContainer, safetyPasswordFocused && styles.inputContainerFocused]}>
                <Ionicons name="shield-outline" size={20} color={safetyPasswordFocused ? '#8b3fa0' : '#999'} style={styles.inputIcon} />
                <TextInput
                  style={styles.input}
                  placeholder="Safety password"
                  placeholderTextColor="#999"
                  value={safetyPassword}
                  onChangeText={setSafetyPassword}
                  onFocus={() => setSafetyPasswordFocused(true)}
                  onBlur={() => setSafetyPasswordFocused(false)}
                  secureTextEntry={!showSafetyPassword}
                  editable={!loading}
                />
                <TouchableOpacity onPress={() => setShowSafetyPassword(!showSafetyPassword)} style={styles.eyeIcon}>
                  <Ionicons name={showSafetyPassword ? 'eye-outline' : 'eye-off-outline'} size={20} color="#999" />
                </TouchableOpacity>
              </View>

              <View style={[styles.inputContainer, confirmSafetyFocused && styles.inputContainerFocused]}>
                <Ionicons name="shield-checkmark-outline" size={20} color={confirmSafetyFocused ? '#8b3fa0' : '#999'} style={styles.inputIcon} />
                <TextInput
                  style={styles.input}
                  placeholder="Confirm safety password"
                  placeholderTextColor="#999"
                  value={confirmSafetyPassword}
                  onChangeText={setConfirmSafetyPassword}
                  onFocus={() => setConfirmSafetyFocused(true)}
                  onBlur={() => setConfirmSafetyFocused(false)}
                  secureTextEntry={!showConfirmSafetyPassword}
                  editable={!loading}
                />
                <TouchableOpacity onPress={() => setShowConfirmSafetyPassword(!showConfirmSafetyPassword)} style={styles.eyeIcon}>
                  <Ionicons name={showConfirmSafetyPassword ? 'eye-outline' : 'eye-off-outline'} size={20} color="#999" />
                </TouchableOpacity>
              </View>

              {confirmSafetyPassword ? (
                <View style={styles.matchContainer}>
                  <Ionicons
                    name={safetyPassword === confirmSafetyPassword ? 'checkmark-circle' : 'close-circle'}
                    size={16}
                    color={safetyPassword === confirmSafetyPassword ? '#2ed573' : '#ff4757'}
                  />
                  <Text style={[styles.matchText, { color: safetyPassword === confirmSafetyPassword ? '#2ed573' : '#ff4757' }]}>
                    {safetyPassword === confirmSafetyPassword ? 'Safety passwords match' : 'Safety passwords do not match'}
                  </Text>
                </View>
              ) : null}

              {/* Sign Up Button */}
              <Animated.View style={[{ transform: [{ scale: buttonScale }] }, { marginTop: 8 }]}>
                <TouchableOpacity
                  style={[styles.signupButton, loading && styles.signupButtonDisabled]}
                  onPress={handleSignUp}
                  activeOpacity={0.8}
                  disabled={loading}
                >
                  <LinearGradient
                    colors={loading ? ['#999', '#aaa', '#bbb'] : ['#8b3fa0', '#c850c0', '#ff6ec7']}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 0 }}
                    style={styles.signupGradient}
                  >
                    {loading ? (
                      <ActivityIndicator color="#fff" size="small" />
                    ) : (
                      <>
                        <Text style={styles.signupButtonText}>Create Account</Text>
                        <Ionicons name="arrow-forward" size={20} color="#fff" />
                      </>
                    )}
                  </LinearGradient>
                </TouchableOpacity>
              </Animated.View>
            </Animated.View>

            <Animated.View
              style={[styles.signinContainer, { opacity: fadeAnim, transform: [{ translateY: slideAnim }] }]}
            >
              <Text style={styles.signinText}>Already have an account? </Text>
              <TouchableOpacity
                onPress={() => (navigation.canGoBack() ? navigation.goBack() : navigation.navigate('Login'))}
              >
                <Text style={styles.signinLink}>Sign In</Text>
              </TouchableOpacity>
            </Animated.View>
          </KeyboardAvoidingView>
        </ScrollView>
      </LinearGradient>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  gradient: { flex: 1 },
  scrollContent: { flexGrow: 1, justifyContent: 'center' },
  keyboardView: { flex: 1, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 24, paddingVertical: 60 },
  circle: { position: 'absolute', borderRadius: 999, opacity: 0.08, backgroundColor: '#fff' },
  circle1: { width: 300, height: 300, top: -80, right: -60 },
  circle2: { width: 200, height: 200, bottom: 100, left: -50 },
  circle3: { width: 150, height: 150, top: height * 0.35, right: -30 },
  logoContainer: { alignItems: 'center', marginBottom: 24 },
  shieldIcon: { width: 64, height: 64, borderRadius: 20, backgroundColor: 'rgba(255,255,255,0.15)', justifyContent: 'center', alignItems: 'center', marginBottom: 8, borderWidth: 1, borderColor: 'rgba(255,255,255,0.2)' },
  appName: { fontSize: 26, fontWeight: '800', color: '#fff', letterSpacing: 1.5 },
  errorContainer: { flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(255,71,87,0.15)', borderRadius: 12, paddingHorizontal: 16, paddingVertical: 10, marginBottom: 16, width: '100%', maxWidth: 400, gap: 8, borderWidth: 1, borderColor: 'rgba(255,71,87,0.3)' },
  errorText: { color: '#ff6b81', fontSize: 13, fontWeight: '500', flex: 1 },
  card: { width: '100%', maxWidth: 400, backgroundColor: 'rgba(255,255,255,0.95)', borderRadius: 24, padding: 28, shadowColor: '#000', shadowOffset: { width: 0, height: 20 }, shadowOpacity: 0.15, shadowRadius: 40, elevation: 20 },
  welcomeText: { fontSize: 24, fontWeight: '700', color: '#1a0533', marginBottom: 4 },
  subtitle: { fontSize: 14, color: '#888', marginBottom: 10 },
  securityHint: { fontSize: 12, color: '#6f6790', lineHeight: 18, marginBottom: 18 },
  inputContainer: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#f5f5f8', borderRadius: 14, paddingHorizontal: 14, marginBottom: 14, height: 52, borderWidth: 2, borderColor: 'transparent' },
  inputContainerFocused: { borderColor: '#8b3fa0', backgroundColor: '#faf5fc' },
  inputIcon: { marginRight: 10 },
  input: { flex: 1, fontSize: 15, color: '#333' },
  eyeIcon: { padding: 4 },
  strengthContainer: { flexDirection: 'row', alignItems: 'center', marginBottom: 14, marginTop: -6, gap: 8 },
  strengthBars: { flexDirection: 'row', gap: 4, flex: 1 },
  strengthBar: { height: 4, flex: 1, borderRadius: 2 },
  strengthLabel: { fontSize: 11, fontWeight: '600' },
  matchContainer: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: -6, marginBottom: 8 },
  matchText: { fontSize: 12, fontWeight: '500' },
  signupButton: { borderRadius: 14, overflow: 'hidden', marginBottom: 4, shadowColor: '#c850c0', shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.3, shadowRadius: 16, elevation: 8 },
  signupButtonDisabled: { shadowOpacity: 0.1 },
  signupGradient: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingVertical: 15, gap: 8 },
  signupButtonText: { fontSize: 16, fontWeight: '700', color: '#fff', letterSpacing: 0.5 },
  signinContainer: { flexDirection: 'row', marginTop: 24 },
  signinText: { color: 'rgba(255,255,255,0.7)', fontSize: 14 },
  signinLink: { color: '#ff6ec7', fontSize: 14, fontWeight: '700' },
});
