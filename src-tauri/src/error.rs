//! 错误类型统一由 core 提供，这里只做 re-export，避免两处维护。
pub use skill_studio_core::Error as AppError;
pub use skill_studio_core::Result as AppResult;
