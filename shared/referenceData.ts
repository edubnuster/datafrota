export type ReferenceOption = {
  code: string;
  name: string;
  value?: string;
};

export type ReferenceDataType =
  | "products"
  | "product-groups"
  | "customer-groups"
  | "customers"
  | "branches"
  | "payment-forms";
