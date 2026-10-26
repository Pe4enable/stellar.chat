#![no_std]

// CVE-2026-32322 (soroban-sdk 25.2.0, GHSA-x2hw-px52-wp4m): Bn254 Fr
// сравнивается как сырой U256 и не приводится по модулю порядка поля r
// ни в from_bytes/from_u256, ни в PartialEq. Два равных элемента поля
// с разной записью (каноническая и нередуцированная, значение >= r)
// здесь не равны. spend считает такой nullifier новым и принимает повтор.

use soroban_sdk::{
    contract, contractimpl, contracttype, crypto::bn254::Fr, BytesN, Env, Vec,
};

#[contracttype]
#[derive(Clone)]
enum DataKey {
    Spent,
}

#[contract]
pub struct FrNullifier;

fn spent_nullifiers(env: &Env) -> Vec<BytesN<32>> {
    env.storage()
        .instance()
        .get(&DataKey::Spent)
        .unwrap_or_else(|| Vec::new(env))
}

fn already_spent(env: &Env, presented: &Fr) -> bool {
    let spent = spent_nullifiers(env);
    for i in 0..spent.len() {
        let seen = Fr::from_bytes(spent.get(i).unwrap());
        if seen == *presented {
            return true;
        }
    }
    false
}

#[contractimpl]
impl FrNullifier {
    pub fn is_spent(env: Env, nullifier: BytesN<32>) -> bool {
        already_spent(&env, &Fr::from_bytes(nullifier))
    }

    pub fn spend(env: Env, nullifier: BytesN<32>) {
        let presented = Fr::from_bytes(nullifier);
        if already_spent(&env, &presented) {
            panic!("nullifier already spent");
        }

        let mut spent = spent_nullifiers(&env);
        spent.push_back(presented.to_bytes());
        env.storage().instance().set(&DataKey::Spent, &spent);
    }
}
