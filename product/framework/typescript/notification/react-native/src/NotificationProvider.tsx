import { useEffect, useRef, type ReactElement, type ReactNode } from "react";
import {
  createNotificationManager,
  type NotificationManager,
  type NotificationManagerConfig,
} from "@k1s0-ts-notification/core";
import { NotificationContext } from "./context.js";

export type NotificationProviderProps =
  | {
      manager: NotificationManager;
      config?: undefined;
      children: ReactNode;
    }
  | {
      config?: NotificationManagerConfig;
      manager?: undefined;
      children: ReactNode;
    };

export function NotificationProvider(props: NotificationProviderProps): ReactElement {
  const externalManager = props.manager;
  const internalManagerRef = useRef<NotificationManager | null>(null);

  if (externalManager === undefined && internalManagerRef.current === null) {
    internalManagerRef.current = createNotificationManager(props.config);
  }

  useEffect(() => {
    return () => {
      internalManagerRef.current?.dispose();
      internalManagerRef.current = null;
    };
  }, []);

  const value = externalManager ?? internalManagerRef.current;

  return <NotificationContext.Provider value={value}>{props.children}</NotificationContext.Provider>;
}
