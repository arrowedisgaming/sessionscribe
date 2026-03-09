/**
 * Session Scribe — Error Boundary
 * Copyright (C) 2026 Arrowed
 * License: GPL-3.0-or-later
 */

import React from 'react';

interface Props {
  children: React.ReactNode;
}

interface State {
  hasError: boolean;
  error?: Error;
}

export class ErrorBoundary extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo): void {
    console.error('ErrorBoundary caught:', error, info.componentStack);
  }

  handleReload = (): void => {
    this.setState({ hasError: false, error: undefined });
  };

  render(): React.ReactNode {
    if (this.state.hasError) {
      return (
        <div className="flex flex-col items-center justify-center h-full p-8 text-center">
          <h2 className="text-xl font-semibold text-red-400 mb-2">Something went wrong</h2>
          <p className="text-gray-400 mb-4 max-w-md">
            {this.state.error?.message || 'An unexpected error occurred.'}
          </p>
          <button
            onClick={this.handleReload}
            className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-500"
          >
            Reload
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
