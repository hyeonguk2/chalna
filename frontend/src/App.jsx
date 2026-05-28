import { BrowserRouter, Routes, Route } from "react-router-dom";
import HomePage from "./Home";
import Login from "./Login";
import Signup from "./Signup";

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/login" element={<Login />} />
        <Route path="/signup" element={<Signup />} />
      </Routes>
    </BrowserRouter>
  );
}