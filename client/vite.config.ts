import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// 백엔드(`server/`) 위치. 로컬 개발에서 vite dev server 가 /api/* 호출을 이 주소로 proxy 한다.
// 프로덕션에선 nginx 가 같은 origin 의 /api/* 를 처리하므로 이 설정과 무관하다.
const BACKEND_URL = process.env.ERD_BACKEND_URL || 'http://localhost:3001'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': {
        target: BACKEND_URL,
        changeOrigin: true,
      },
    },
  },
})
