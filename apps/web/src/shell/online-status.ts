import { useEffect, useState } from "react";

export function useOnlineStatus(): boolean {
  const [isOnline, setIsOnline] = useState(() => navigator.onLine);

  useEffect(() => {
    function markOnline() {
      setIsOnline(true);
    }

    function markOffline() {
      setIsOnline(false);
    }

    window.addEventListener("online", markOnline);
    window.addEventListener("offline", markOffline);
    return () => {
      window.removeEventListener("online", markOnline);
      window.removeEventListener("offline", markOffline);
    };
  }, []);

  return isOnline;
}
