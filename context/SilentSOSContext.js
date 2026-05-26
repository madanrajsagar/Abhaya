import React, { createContext, useEffect, useState } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";

export const SilentSOSContext = createContext();

export const SilentSOSProvider = ({ children }) => {
  const [silentModeEnabled, setSilentModeEnabled] = useState(false);
  const triggerSilentSOS = () => {
  console.log("Silent SOS Triggered");
};

  useEffect(() => {
    fetchSilentModePreference();
  }, []);

  const fetchSilentModePreference = async () => {
    try {
      const storedValue = await AsyncStorage.getItem("silent_sos_mode");

      if (storedValue !== null) {
        setSilentModeEnabled(JSON.parse(storedValue));
      }
    } catch (err) {
      console.log("Unable to load silent mode:", err);
    }
  };

  const updateSilentMode = async (value) => {
    try {
      setSilentModeEnabled(value);

      await AsyncStorage.setItem(
        "silent_sos_mode",
        JSON.stringify(value)
      );
    } catch (err) {
      console.log("Unable to save silent mode:", err);
    }
  };

  return (
    <SilentSOSContext.Provider
      value={{
        silentModeEnabled,
        updateSilentMode,
        triggerSilentSOS,
      }}
    >
      {children}
    </SilentSOSContext.Provider>
  );
};