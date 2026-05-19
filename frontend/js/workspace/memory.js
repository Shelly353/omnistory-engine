// frontend/js/workspace/memory.js
window.OmniWorkspaceMemory = (() => {
    const DEFAULT_MESSAGE_CONTENT_LIMIT = 3500;
    const DEFAULT_MEMORY_SUMMARY_LIMIT = 6000;

    function stripFencedBlocks(text) {
        return (text || '').replace(/```[a-zA-Z]*\s*[\s\S]*?\s*```/g, '').trim();
    }

    function stripSystemAppendix(text) {
        return (text || '').replace(/\n\n\(系统附加：[\s\S]*?\)$/g, '').trim();
    }

    function limitText(text, maxLength = DEFAULT_MESSAGE_CONTENT_LIMIT) {
        const value = (text || '').trim();
        if (value.length <= maxLength) return value;
        return value.slice(0, Math.floor(maxLength * 0.55)) + '\n\n[...中间内容已压缩...]\n\n' + value.slice(-Math.floor(maxLength * 0.35));
    }

    function cleanConversationMessage(msg, maxLength = DEFAULT_MESSAGE_CONTENT_LIMIT) {
        const content = msg.role === 'assistant'
            ? stripFencedBlocks(msg.content) || '已更新设定数据。'
            : stripSystemAppendix(msg.content);

        return {
            role: msg.role,
            content: limitText(content, maxLength)
        };
    }

    function buildMemorySummary(messages, options = {}) {
        const maxLength = options.maxLength || DEFAULT_MEMORY_SUMMARY_LIMIT;
        const messageLimit = options.messageLimit || DEFAULT_MESSAGE_CONTENT_LIMIT;
        const cleaned = messages.map(msg => cleanConversationMessage(msg, messageLimit)).filter(msg => msg.content);
        if (cleaned.length === 0) return '';

        let summary = '';
        for (let i = cleaned.length - 1; i >= 0; i--) {
            const label = cleaned[i].role === 'user' ? '用户' : 'AI';
            const line = `${label}: ${cleaned[i].content}\n\n`;
            if ((summary.length + line.length) > maxLength) break;
            summary = line + summary;
        }
        return summary.trim();
    }

    function buildChatPayload(conversation, options = {}) {
        const recentLimit = options.recentLimit || 10;
        const messageLimit = options.messageLimit || DEFAULT_MESSAGE_CONTENT_LIMIT;
        const memoryLimit = options.memoryLimit || DEFAULT_MEMORY_SUMMARY_LIMIT;
        const recent = conversation
            .slice(-recentLimit)
            .map(msg => cleanConversationMessage(msg, messageLimit))
            .filter(msg => msg.content);
        const memorySummary = buildMemorySummary(conversation.slice(0, -recentLimit), {
            maxLength: memoryLimit,
            messageLimit
        });
        return { conversation: recent, memorySummary };
    }

    return {
        stripFencedBlocks,
        stripSystemAppendix,
        limitText,
        cleanConversationMessage,
        buildMemorySummary,
        buildChatPayload
    };
})();
