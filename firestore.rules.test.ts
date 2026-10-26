import { readFileSync } from 'fs';
import {
  initializeTestEnvironment,
  assertFails,
  assertSucceeds,
  RulesTestEnvironment,
} from '@firebase/rules-unit-testing';

let testEnv: RulesTestEnvironment;

export async function runRulesTests() {
  testEnv = await initializeTestEnvironment({
    projectId: 'merlion-kyat-vault-test',
    firestore: {
      rules: readFileSync('firestore.rules', 'utf8'),
    },
  });

  const alice = testEnv.authenticatedContext('alice_uid', { email_verified: true });
  const unverifiedBob = testEnv.authenticatedContext('bob_uid', { email_verified: false });
  const mallory = testEnv.authenticatedContext('mallory_uid', { email_verified: true });

  const aliceDb = alice.firestore();
  const bobDb = unverifiedBob.firestore();
  const malloryDb = mallory.firestore();

  // Dirty Dozen #1: Identity Spoofing
  await assertFails(
    aliceDb.doc('vaultConfigs/alice_uid').set({
      ownerId: 'mallory_uid',
      sgdToMmkRate: 3350,
      bankOfficialRate: 2950,
      monthlySalarySgd: 5500,
      monthlyRentSgd: 1100,
      monthlySavingsTargetSgd: 1500,
      biometricEnabled: false,
      passkeyId: '',
      pinCode: '1234',
      autoLockMinutes: 5,
    })
  );

  // Dirty Dozen #2: Cross-Tenant Read
  await assertFails(malloryDb.doc('vaultConfigs/alice_uid').get());

  // Dirty Dozen #3: Unverified Email Write
  await assertFails(
    bobDb.doc('vaultConfigs/bob_uid').set({
      ownerId: 'bob_uid',
      sgdToMmkRate: 3350,
      bankOfficialRate: 2950,
      monthlySalarySgd: 4000,
      monthlyRentSgd: 900,
      monthlySavingsTargetSgd: 1000,
      biometricEnabled: false,
      passkeyId: '',
      pinCode: '',
      autoLockMinutes: 5,
    })
  );

  // Dirty Dozen #4: Shadow Field Injection
  await assertFails(
    aliceDb.doc('vaultConfigs/alice_uid').set({
      ownerId: 'alice_uid',
      sgdToMmkRate: 3350,
      bankOfficialRate: 2950,
      monthlySalarySgd: 5500,
      monthlyRentSgd: 1100,
      monthlySavingsTargetSgd: 1500,
      biometricEnabled: false,
      passkeyId: '',
      pinCode: '',
      autoLockMinutes: 5,
      isAdmin: true,
    })
  );

  await testEnv.cleanup();
}
