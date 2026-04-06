import * as React from "react";

interface Props {
  children: React.ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

class ErrorBoundary extends React.Component<Props, State> {
  state: State = {
    hasError: false,
    error: null,
  };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error("Uncaught error:", error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex h-screen w-screen flex-col items-center justify-center bg-[#0a0e1a] p-8 text-center text-white">
          <h1 className="mb-4 text-4xl font-black text-red-500">¡UPS! ALGO SALIÓ MAL</h1>
          <p className="mb-8 text-gray-400">
            {this.state.error?.message.startsWith('{') 
              ? "Error de permisos en Firestore. Revisa las reglas de seguridad."
              : this.state.error?.message || "Ocurrió un error inesperado."}
          </p>
          <button
            onClick={() => window.location.reload()}
            className="rounded-full bg-blue-600 px-8 py-3 font-bold hover:bg-blue-500"
          >
            Reiniciar Aplicación
          </button>
        </div>
      );
    }

    return (this as any).props.children;
  }
}

export default ErrorBoundary;
