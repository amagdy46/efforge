import { createContext, type ReactNode, useContext, useEffect, useState } from "react"

export type Theme = "light" | "dark" | "system"

const STORAGE_KEY = "theme"

/** Runs before first paint (inlined in <head>) so there is no flash of the wrong theme. */
export const themeScript = `(function(){try{var t=localStorage.getItem("${STORAGE_KEY}")||"system";var d=t==="dark"||(t==="system"&&matchMedia("(prefers-color-scheme: dark)").matches);document.documentElement.classList.toggle("dark",d)}catch(e){}})()`

const ThemeContext = createContext<{ theme: Theme; setTheme: (theme: Theme) => void }>({
  theme: "system",
  setTheme: () => {},
})

const apply = (theme: Theme) => {
  const dark =
    theme === "dark" || (theme === "system" && matchMedia("(prefers-color-scheme: dark)").matches)
  document.documentElement.classList.toggle("dark", dark)
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>("system")

  useEffect(() => {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (stored === "light" || stored === "dark" || stored === "system") setThemeState(stored)
  }, [])

  useEffect(() => {
    if (theme !== "system") return
    const query = matchMedia("(prefers-color-scheme: dark)")
    const onChange = () => apply("system")
    query.addEventListener("change", onChange)
    return () => query.removeEventListener("change", onChange)
  }, [theme])

  const setTheme = (next: Theme) => {
    localStorage.setItem(STORAGE_KEY, next)
    setThemeState(next)
    apply(next)
  }

  return <ThemeContext value={{ theme, setTheme }}>{children}</ThemeContext>
}

export const useTheme = () => useContext(ThemeContext)
