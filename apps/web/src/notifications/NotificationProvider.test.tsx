import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { NotificationProvider, useNotifications } from "./index.js";

function NotificationProbe() {
  const { activeToasts, addNotification, dismissNotification, history } =
    useNotifications();

  return (
    <div>
      <button
        type="button"
        onClick={() => {
          addNotification({
            title: `Saved\u0000 ${"x".repeat(200)}`,
            message: "The persistent activity record remains available.",
            kind: "success",
          });
        }}
      >
        Add saved notification
      </button>
      <button
        type="button"
        onClick={() => {
          addNotification({
            title: "History only",
            toast: false,
          });
        }}
      >
        Add history notification
      </button>
      <output data-testid="active-toast-count">{activeToasts.length}</output>
      <ul aria-label="Notification history">
        {history.map((notification) => (
          <li key={notification.id}>
            <span>{notification.title}</span>
            <span>{notification.kind}</span>
            <span>{notification.dismissed ? "Dismissed" : "Active"}</span>
            {!notification.dismissed && notification.toast ? (
              <button
                type="button"
                onClick={() => {
                  dismissNotification(notification.id);
                }}
              >
                Dismiss {notification.title}
              </button>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}

describe("NotificationProvider", () => {
  it("dismisses a toast without deleting its history record", () => {
    render(
      <NotificationProvider>
        <NotificationProbe />
      </NotificationProvider>,
    );

    fireEvent.click(
      screen.getByRole("button", { name: "Add saved notification" }),
    );
    fireEvent.click(screen.getByRole("button", { name: /Dismiss Saved/iu }));

    const history = screen.getByRole("list", {
      name: "Notification history",
    });

    expect(within(history).getAllByRole("listitem")).toHaveLength(1);
    expect(within(history).getByText("Dismissed")).toBeVisible();
    expect(screen.getByTestId("active-toast-count")).toHaveTextContent("0");
  });

  it("can add a durable history item without presenting it as a toast", () => {
    render(
      <NotificationProvider>
        <NotificationProbe />
      </NotificationProvider>,
    );

    fireEvent.click(
      screen.getByRole("button", { name: "Add history notification" }),
    );

    expect(
      within(
        screen.getByRole("list", { name: "Notification history" }),
      ).getByText("History only"),
    ).toBeVisible();
    expect(screen.getByTestId("active-toast-count")).toHaveTextContent("0");
  });

  it("rejects access outside its provider", () => {
    expect(() => render(<NotificationProbe />)).toThrow(
      new Error("useNotifications must be used within a NotificationProvider."),
    );
  });
});
