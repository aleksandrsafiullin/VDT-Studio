import { create } from "zustand";
import type { ProviderConnectionCheck } from "./provider-connection";
export const useProviderConnectionCheck = create<ProviderConnectionCheck>(() => ({}));
