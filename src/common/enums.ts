export enum UserStatus {
  Active = 'active',
  Inactive = 'inactive',
}

export enum WalletType {
  Personal = 'personal',
  Shared = 'shared',
}

export enum WalletCurrency {
  VND = 'VND',
  USD = 'USD',
}

export enum WalletMemberRole {
  Owner = 'owner',
  Member = 'member',
}

export enum WalletMemberStatus {
  Active = 'active',
  Inactive = 'inactive',
}

export enum ExpenseSplitMethod {
  Equal = 'equal',
  Amount = 'amount',
  Percentage = 'percentage',
  Shares = 'shares',
}

export enum SettlementStatus {
  Pending = 'pending',
  Paid = 'paid',
  Cancelled = 'cancelled',
}

export function isEnumValue<T extends Record<string, string>>(
  enumObject: T,
  value: string
): value is T[keyof T] {
  return Object.values(enumObject).includes(value);
}
