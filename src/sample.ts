export const SAMPLE_FILENAME = "vault.rs";

export const SAMPLE = `#![no_std]
use soroban_sdk::{contract, contractimpl, symbol_short, token, Address, Env};

#[contract]
pub struct Vault;

#[contractimpl]
impl Vault {
    pub fn init(env: Env, admin: Address, token: Address) {
        env.storage().instance().set(&symbol_short!("admin"), &admin);
        env.storage().instance().set(&symbol_short!("token"), &token);
    }

    pub fn deposit(env: Env, from: Address, amount: i128) {
        from.require_auth();
        let token_id: Address = env.storage().instance().get(&symbol_short!("token")).unwrap();
        token::Client::new(&env, &token_id).transfer(
            &from,
            &env.current_contract_address(),
            &amount,
        );
    }

    pub fn withdraw(env: Env, to: Address, amount: i128) {
        let token_id: Address = env.storage().instance().get(&symbol_short!("token")).unwrap();
        token::Client::new(&env, &token_id).transfer(
            &env.current_contract_address(),
            &to,
            &amount,
        );
    }

    pub fn set_admin(env: Env, new_admin: Address) {
        env.storage().instance().set(&symbol_short!("admin"), &new_admin);
    }
}
`;
