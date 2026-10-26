#![no_std]

// Уязвимость: transfer_internal читает балансы from и to в локальные
// переменные до записи в storage. Если from == to, оба чтения — один и тот
// же ключ Balance. Вторая запись использует устаревший снимок и
// перезаписывает уже уменьшенный баланс значением (старый баланс + value).
// Self-transfer поэтому увеличивает баланс отправителя на value — токены
// минтятся, а total_supply не меняется. Сумма балансов расходится с total_supply.

use soroban_sdk::{contract, contractevent, contractimpl, contracttype, Address, Env, String};

const DAY_IN_LEDGERS: u32 = 17280;
const INSTANCE_BUMP_AMOUNT: u32 = 7 * DAY_IN_LEDGERS;
const INSTANCE_LIFETIME_THRESHOLD: u32 = INSTANCE_BUMP_AMOUNT - DAY_IN_LEDGERS;
const BALANCE_BUMP_AMOUNT: u32 = 30 * DAY_IN_LEDGERS;
const BALANCE_LIFETIME_THRESHOLD: u32 = BALANCE_BUMP_AMOUNT - DAY_IN_LEDGERS;

#[contracttype]
#[derive(Clone)]
pub struct AllowanceKey {
    pub from: Address,
    pub spender: Address,
}

#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    Balance(Address),
    Allowance(AllowanceKey),
    Name,
    Symbol,
    Decimals,
    TotalSupply,
}

#[contract]
pub struct SuperToken;

#[contractevent]
pub struct Transfer {
    #[topic]
    pub from: Address,
    #[topic]
    pub to: Address,
    pub value: i128,
}

#[contractevent]
pub struct Approval {
    #[topic]
    pub owner: Address,
    #[topic]
    pub spender: Address,
    pub value: i128,
}

fn require_nonnegative(value: i128) {
    if value < 0 {
        panic!("negative amount");
    }
}

fn read_balance(env: &Env, addr: &Address) -> i128 {
    let key = DataKey::Balance(addr.clone());
    let balance = env
        .storage()
        .persistent()
        .get::<DataKey, i128>(&key)
        .unwrap_or(0);
    env.storage()
        .persistent()
        .extend_ttl(&key, BALANCE_LIFETIME_THRESHOLD, BALANCE_BUMP_AMOUNT);
    balance
}

fn write_balance(env: &Env, addr: &Address, amount: i128) {
    let key = DataKey::Balance(addr.clone());
    env.storage().persistent().set(&key, &amount);
    env.storage()
        .persistent()
        .extend_ttl(&key, BALANCE_LIFETIME_THRESHOLD, BALANCE_BUMP_AMOUNT);
}

fn transfer_internal(env: &Env, from: &Address, to: &Address, value: i128) {
    require_nonnegative(value);

    let balance_from = read_balance(env, from);
    let balance_to = read_balance(env, to);
    if balance_from < value {
        panic!("insufficient balance");
    }

    write_balance(env, from, balance_from - value);
    write_balance(env, to, balance_to + value);

    Transfer {
        from: from.clone(),
        to: to.clone(),
        value,
    }
    .publish(env);
}

#[contractimpl]
impl SuperToken {
    pub fn __constructor(
        env: Env,
        admin: Address,
        name: String,
        symbol: String,
        decimals: u32,
        total_supply: i128,
    ) {
        require_nonnegative(total_supply);

        env.storage().instance().set(&DataKey::Name, &name);
        env.storage().instance().set(&DataKey::Symbol, &symbol);
        env.storage().instance().set(&DataKey::Decimals, &decimals);
        env.storage()
            .instance()
            .set(&DataKey::TotalSupply, &total_supply);
        env.storage()
            .instance()
            .extend_ttl(INSTANCE_LIFETIME_THRESHOLD, INSTANCE_BUMP_AMOUNT);

        write_balance(&env, &admin, total_supply);

        Transfer {
            from: env.current_contract_address(),
            to: admin,
            value: total_supply,
        }
        .publish(&env);
    }

    pub fn name(env: Env) -> String {
        env.storage().instance().get(&DataKey::Name).unwrap()
    }

    pub fn symbol(env: Env) -> String {
        env.storage().instance().get(&DataKey::Symbol).unwrap()
    }

    pub fn decimals(env: Env) -> u32 {
        env.storage().instance().get(&DataKey::Decimals).unwrap()
    }

    pub fn total_supply(env: Env) -> i128 {
        env.storage().instance().get(&DataKey::TotalSupply).unwrap()
    }

    pub fn balance_of(env: Env, owner: Address) -> i128 {
        read_balance(&env, &owner)
    }

    pub fn allowance(env: Env, owner: Address, spender: Address) -> i128 {
        let key = DataKey::Allowance(AllowanceKey {
            from: owner,
            spender,
        });
        env.storage()
            .persistent()
            .get::<DataKey, i128>(&key)
            .unwrap_or(0)
    }

    pub fn transfer(env: Env, from: Address, to: Address, value: i128) -> bool {
        from.require_auth();
        transfer_internal(&env, &from, &to, value);
        true
    }

    pub fn approve(env: Env, owner: Address, spender: Address, value: i128) -> bool {
        owner.require_auth();
        require_nonnegative(value);

        let key = DataKey::Allowance(AllowanceKey {
            from: owner.clone(),
            spender: spender.clone(),
        });
        env.storage().persistent().set(&key, &value);
        env.storage().persistent().extend_ttl(
            &key,
            BALANCE_LIFETIME_THRESHOLD,
            BALANCE_BUMP_AMOUNT,
        );

        Approval {
            owner,
            spender,
            value,
        }
        .publish(&env);
        true
    }

    pub fn transfer_from(
        env: Env,
        spender: Address,
        from: Address,
        to: Address,
        value: i128,
    ) -> bool {
        spender.require_auth();
        require_nonnegative(value);

        let key = DataKey::Allowance(AllowanceKey {
            from: from.clone(),
            spender: spender.clone(),
        });
        let allowed: i128 = env
            .storage()
            .persistent()
            .get::<DataKey, i128>(&key)
            .unwrap_or(0);
        if allowed < value {
            panic!("insufficient allowance");
        }
        env.storage().persistent().set(&key, &(allowed - value));
        env.storage().persistent().extend_ttl(
            &key,
            BALANCE_LIFETIME_THRESHOLD,
            BALANCE_BUMP_AMOUNT,
        );

        transfer_internal(&env, &from, &to, value);
        true
    }
}
