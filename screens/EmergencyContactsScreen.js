import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  StatusBar,
  TextInput,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import {
  addEmergencyEmailContact,
  getEmergencyEmailContacts,
  removeEmergencyEmailContact,
  updateEmergencyEmailContact,
} from '../services/emergencyEmailContacts';

const getEmailInitial = (label, email) =>
  String(label || email || '').trim().charAt(0).toUpperCase() || 'E';

export default function EmergencyContactsScreen({ navigation }) {
  const [emailContacts, setEmailContacts] = useState([]);
  const [labelInput, setLabelInput] = useState('');
  const [emailInput, setEmailInput] = useState('');
  const [editingId, setEditingId] = useState(null);
  const [editLabel, setEditLabel] = useState('');
  const [editEmail, setEditEmail] = useState('');
  const [isLoadingEmails, setIsLoadingEmails] = useState(true);
  const [isSavingEmail, setIsSavingEmail] = useState(false);

  const editingContact = useMemo(
    () => emailContacts.find((item) => item.id === editingId) || null,
    [editingId, emailContacts]
  );

  const loadEmailContacts = useCallback(async () => {
    setIsLoadingEmails(true);
    try {
      const emails = await getEmergencyEmailContacts();
      setEmailContacts(emails);
    } finally {
      setIsLoadingEmails(false);
    }
  }, []);

  useEffect(() => {
    loadEmailContacts();
  }, [loadEmailContacts]);

  const resetAddForm = useCallback(() => {
    setLabelInput('');
    setEmailInput('');
  }, []);

  const handleAddEmail = useCallback(async () => {
    setIsSavingEmail(true);
    try {
      const next = await addEmergencyEmailContact({
        label: labelInput,
        email: emailInput,
      });
      setEmailContacts(next);
      resetAddForm();
    } catch (error) {
      Alert.alert('Could Not Add Email', error?.message || 'Try a different email address.');
    } finally {
      setIsSavingEmail(false);
    }
  }, [emailInput, labelInput, resetAddForm]);

  const startEditing = useCallback((contact) => {
    setEditingId(contact.id);
    setEditLabel(contact.label);
    setEditEmail(contact.email);
  }, []);

  const cancelEditing = useCallback(() => {
    setEditingId(null);
    setEditLabel('');
    setEditEmail('');
  }, []);

  const handleSaveEdit = useCallback(async () => {
    if (!editingId) {
      return;
    }

    setIsSavingEmail(true);
    try {
      const next = await updateEmergencyEmailContact({
        id: editingId,
        label: editLabel,
        email: editEmail,
      });
      setEmailContacts(next);
      cancelEditing();
    } catch (error) {
      Alert.alert('Could Not Save Email', error?.message || 'Please review the label and email.');
    } finally {
      setIsSavingEmail(false);
    }
  }, [cancelEditing, editEmail, editLabel, editingId]);

  const handleRemoveEmail = useCallback((contact) => {
    Alert.alert(
      'Remove Email',
      `Stop sending SOS emails to ${contact.label}?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: async () => {
            try {
              const next = await removeEmergencyEmailContact(contact.id);
              setEmailContacts(next);
              if (editingId === contact.id) {
                cancelEditing();
              }
            } catch (error) {
              Alert.alert('Could Not Remove Email', error?.message || 'Please try again.');
            }
          },
        },
      ]
    );
  }, [cancelEditing, editingId]);

  return (
    <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
      <StatusBar barStyle="dark-content" backgroundColor="#f7f3ff" />

      <View style={styles.header}>
        <TouchableOpacity
          onPress={() => (navigation.canGoBack() ? navigation.goBack() : navigation.navigate('Home'))}
          style={styles.backButton}
        >
          <Ionicons name="arrow-back" size={24} color="#111" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Emergency Contacts</Text>
        <View style={{ width: 24 }} />
      </View>

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.statusCard}>
          <Text style={styles.statusTitle}>Emergency Email Alerts</Text>
          <Text style={styles.statusText}>
            SOS report emails use this list right now. Add labels like Mom Email, Dad Email, Police Email, or Hostel Warden Email so each address is easy to identify.
          </Text>
        </View>

        <View style={styles.emailSectionCard}>
          <View style={styles.emailSectionHeader}>
            <View>
              <Text style={styles.emailSectionTitle}>Emergency Email Recipients</Text>
              <Text style={styles.emailSectionSubtitle}>
                These labels and emails are used for SOS report delivery.
              </Text>
            </View>
            <View style={styles.emailCountBadge}>
              <Text style={styles.emailCountText}>{emailContacts.length}</Text>
            </View>
          </View>

          <View style={styles.addFormCard}>
            <TextInput
              value={labelInput}
              onChangeText={setLabelInput}
              placeholder="Label, e.g. Mom Email"
              placeholderTextColor="#9a93ad"
              style={styles.emailInput}
            />
            <TextInput
              value={emailInput}
              onChangeText={setEmailInput}
              placeholder="Email address"
              placeholderTextColor="#9a93ad"
              keyboardType="email-address"
              autoCapitalize="none"
              autoCorrect={false}
              style={[styles.emailInput, styles.emailInputTopSpacing]}
            />
            <TouchableOpacity
              style={[styles.addEmailButton, isSavingEmail && styles.buttonDisabled]}
              onPress={handleAddEmail}
              disabled={isSavingEmail}
            >
              <Ionicons name="add" size={18} color="#fff" />
              <Text style={styles.addEmailButtonText}>Add Emergency Email</Text>
            </TouchableOpacity>
          </View>

          {isLoadingEmails ? (
            <Text style={styles.emailHelperText}>Loading email recipients...</Text>
          ) : emailContacts.length ? (
            <View style={styles.emailList}>
              {emailContacts.map((contact) => {
                const isEditing = editingId === contact.id;

                return (
                  <View key={contact.id} style={styles.emailCard}>
                    <View style={styles.emailAvatar}>
                      <Text style={styles.emailAvatarText}>
                        {getEmailInitial(contact.label, contact.email)}
                      </Text>
                    </View>

                    <View style={styles.emailDetails}>
                      {isEditing ? (
                        <>
                          <TextInput
                            value={editLabel}
                            onChangeText={setEditLabel}
                            placeholder="Label"
                            placeholderTextColor="#9a93ad"
                            style={styles.inlineInput}
                          />
                          <TextInput
                            value={editEmail}
                            onChangeText={setEditEmail}
                            placeholder="Email address"
                            placeholderTextColor="#9a93ad"
                            keyboardType="email-address"
                            autoCapitalize="none"
                            autoCorrect={false}
                            style={[styles.inlineInput, styles.inlineInputTopSpacing]}
                          />
                          <View style={styles.inlineActionRow}>
                            <TouchableOpacity
                              style={[styles.inlinePrimaryButton, isSavingEmail && styles.buttonDisabled]}
                              onPress={handleSaveEdit}
                              disabled={isSavingEmail}
                            >
                              <Text style={styles.inlinePrimaryButtonText}>Save</Text>
                            </TouchableOpacity>
                            <TouchableOpacity
                              style={styles.inlineSecondaryButton}
                              onPress={cancelEditing}
                            >
                              <Text style={styles.inlineSecondaryButtonText}>Cancel</Text>
                            </TouchableOpacity>
                          </View>
                        </>
                      ) : (
                        <>
                          <Text style={styles.emailLabel}>{contact.label}</Text>
                          <Text style={styles.emailValue}>{contact.email}</Text>
                        </>
                      )}
                    </View>

                    {!isEditing ? (
                      <View style={styles.cardActionColumn}>
                        <TouchableOpacity
                          style={styles.iconButton}
                          onPress={() => startEditing(contact)}
                        >
                          <Ionicons name="create-outline" size={18} color="#7b57d1" />
                        </TouchableOpacity>
                        <TouchableOpacity
                          style={styles.removeEmailButton}
                          onPress={() => handleRemoveEmail(contact)}
                        >
                          <Ionicons name="trash-outline" size={18} color="#ea5455" />
                        </TouchableOpacity>
                      </View>
                    ) : null}
                  </View>
                );
              })}
            </View>
          ) : (
            <Text style={styles.emailHelperText}>
              No emergency emails saved yet. Add a labeled email to receive runtime SOS reports.
            </Text>
          )}

          {editingContact ? (
            <Text style={styles.emailHelperText}>
              Editing {editingContact.label}. Save to update the SOS email recipient instantly.
            </Text>
          ) : null}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fbf9ff',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 16,
  },
  backButton: {
    padding: 4,
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: '800',
    color: '#111',
  },
  content: {
    paddingHorizontal: 20,
    paddingBottom: 40,
  },
  statusCard: {
    backgroundColor: '#fff',
    borderRadius: 20,
    padding: 20,
    shadowColor: '#14092c',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.04,
    shadowRadius: 16,
    elevation: 3,
    marginBottom: 18,
    marginTop: 8,
  },
  statusTitle: {
    fontSize: 15,
    fontWeight: '800',
    color: '#111',
    marginBottom: 8,
  },
  statusText: {
    fontSize: 13,
    color: '#6f6790',
    lineHeight: 20,
    fontWeight: '600',
  },
  emailSectionCard: {
    backgroundColor: '#fff',
    borderRadius: 24,
    padding: 18,
    borderWidth: 1,
    borderColor: '#e9e1ff',
  },
  emailSectionHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 12,
  },
  emailSectionTitle: {
    fontSize: 17,
    fontWeight: '800',
    color: '#24153f',
  },
  emailSectionSubtitle: {
    marginTop: 4,
    color: '#7a7391',
    fontSize: 12,
    lineHeight: 18,
    fontWeight: '600',
  },
  emailCountBadge: {
    minWidth: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: '#efe8ff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  emailCountText: {
    color: '#7b57d1',
    fontSize: 13,
    fontWeight: '800',
  },
  addFormCard: {
    marginTop: 16,
    borderRadius: 18,
    backgroundColor: '#f9f7ff',
    padding: 14,
  },
  emailInput: {
    borderRadius: 16,
    backgroundColor: '#fff',
    paddingHorizontal: 14,
    paddingVertical: 13,
    color: '#111',
    fontSize: 13,
    fontWeight: '600',
  },
  emailInputTopSpacing: {
    marginTop: 10,
  },
  addEmailButton: {
    marginTop: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderRadius: 16,
    backgroundColor: '#7b57d1',
    paddingVertical: 13,
  },
  addEmailButtonText: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '800',
  },
  buttonDisabled: {
    opacity: 0.5,
  },
  emailHelperText: {
    marginTop: 14,
    color: '#8f8f96',
    fontSize: 12,
    lineHeight: 18,
    fontWeight: '600',
  },
  emailList: {
    marginTop: 16,
    gap: 12,
  },
  emailCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    borderRadius: 18,
    backgroundColor: '#f9f7ff',
    padding: 14,
  },
  emailAvatar: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: '#ede4ff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  emailAvatarText: {
    color: '#6f4dc6',
    fontSize: 16,
    fontWeight: '800',
  },
  emailDetails: {
    flex: 1,
  },
  emailLabel: {
    fontSize: 13,
    color: '#1f1533',
    fontWeight: '800',
  },
  emailValue: {
    marginTop: 4,
    color: '#6f6790',
    fontSize: 12,
    fontWeight: '700',
    lineHeight: 18,
  },
  cardActionColumn: {
    gap: 8,
  },
  iconButton: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: '#efe8ff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  removeEmailButton: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: '#fff1f3',
    alignItems: 'center',
    justifyContent: 'center',
  },
  inlineInput: {
    borderRadius: 14,
    backgroundColor: '#fff',
    paddingHorizontal: 12,
    paddingVertical: 11,
    color: '#111',
    fontSize: 13,
    fontWeight: '600',
  },
  inlineInputTopSpacing: {
    marginTop: 8,
  },
  inlineActionRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 10,
  },
  inlinePrimaryButton: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 14,
    backgroundColor: '#7b57d1',
    paddingVertical: 11,
  },
  inlinePrimaryButtonText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '800',
  },
  inlineSecondaryButton: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 14,
    backgroundColor: '#efe8ff',
    paddingVertical: 11,
  },
  inlineSecondaryButtonText: {
    color: '#6f4dc6',
    fontSize: 12,
    fontWeight: '800',
  },
});
