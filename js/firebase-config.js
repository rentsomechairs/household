// Firebase configuration for the Household Hub web app.
// This configuration is safe to include in a browser app; Firestore Security
// Rules and Firebase Authentication determine who may access the data.
export const FIREBASE_SETTINGS = {
  enabled: true,

  // Every device using this app must use this same household document ID.
  // Keep this value synchronized with firestore.rules.
  householdId: "primary-home",

  config: {
    apiKey: "AIzaSyDQLmk3jwe9zXSS9945ffEAXq520gbrG1w",
    authDomain: "household-2c5e2.firebaseapp.com",
    projectId: "household-2c5e2",
    storageBucket: "household-2c5e2.firebasestorage.app",
    messagingSenderId: "343358683223",
    appId: "1:343358683223:web:b8ac552e658d26a3828b12"
  }
};
