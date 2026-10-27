"use client";

import { create } from "zustand";
import type { CliConnectionCheck } from "./cli-connection";

/** Live session state; never persisted as proof of authentication. */
export const useCliConnectionCheck = create<CliConnectionCheck>(() => ({}));
